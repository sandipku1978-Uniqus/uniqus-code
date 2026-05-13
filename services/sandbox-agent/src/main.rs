// Uniqus in-VM sandbox agent — Rust port (Plan §1).
//
// Lives inside a Firecracker microVM at PID 1's first child. Bound to a TCP
// listener on UNIQUS_AGENT_PORT (default 51000). The orchestrator's
// `agentRpc.ts` is the only client; it speaks HTTP/1.1 over vsock, the host
// kernel bridges vsock ↔ TCP, and we serve.
//
// Wire-compatible with the legacy `agent.mjs`: every endpoint, request body,
// and response body is byte-for-byte the same. The orchestrator can swap
// between Node and Rust agents without changes.
//
// Endpoints:
//   GET  /health                     → { ok: true, kind: "rust" }
//   GET  /fs/file?path=…             → { content }
//   PUT  /fs/file                    body: { path, content, encoding? }
//   POST /fs/edit                    body: { path, old_string, new_string }
//   GET  /fs/dir?path=…              → { entries }
//   POST /fs/grep                    body: { pattern, path? } → { matches }
//   POST /exec/run                   body: { command, timeout_ms } → { stdout, stderr, exitCode }
//   POST /exec/start-server          body: { command, port, ready_timeout_ms } → { id, pid, port }
//   POST /exec/stop-server           body: { id }
//   GET  /exec/server-log?id=…       → { log }

use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::os::unix::process::ExitStatusExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tiny_http::{Header, Method, Request, Response, Server};

const SANDBOX_DIR_DEFAULT: &str = "/sandbox";
const HALF_MAX: usize = 8 * 1024;
const MAX_LOG: usize = 64 * 1024;

fn sandbox_dir() -> PathBuf {
    PathBuf::from(std::env::var("UNIQUS_SANDBOX_DIR").unwrap_or_else(|_| SANDBOX_DIR_DEFAULT.into()))
}

fn agent_port() -> u16 {
    std::env::var("UNIQUS_AGENT_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(51_000)
}

/// Per-server bookkeeping for `/exec/start-server` + `/exec/stop-server`.
struct ManagedServer {
    pid: u32,
    port: u16,
    /// We hold the Child so dropping the map entry kills the process. The
    /// reaper thread also feeds it a SIGKILL on `stop-server`.
    child: Child,
    log: Arc<Mutex<String>>,
}

type ServerTable = Arc<Mutex<HashMap<String, ManagedServer>>>;

fn main() {
    let dir = sandbox_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        eprintln!("[uniqus-agent] mkdir {:?} failed: {}", dir, e);
        std::process::exit(1);
    }
    if let Err(e) = std::env::set_current_dir(&dir) {
        eprintln!("[uniqus-agent] chdir {:?} failed: {}", dir, e);
        std::process::exit(1);
    }

    configure_network();

    let port = agent_port();
    let server = match Server::http(("0.0.0.0", port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[uniqus-agent] failed to bind 0.0.0.0:{}: {}", port, e);
            std::process::exit(1);
        }
    };
    eprintln!(
        "[uniqus-agent] listening on port {} (cwd={:?})",
        port,
        std::env::current_dir().unwrap_or_else(|_| dir.clone())
    );

    let servers: ServerTable = Arc::new(Mutex::new(HashMap::new()));
    let server = Arc::new(server);
    // Thread-per-request keeps the implementation small. The only client is
    // the orchestrator and concurrency stays in single digits.
    loop {
        let req = match server.recv() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[uniqus-agent] accept error: {}", e);
                continue;
            }
        };
        let servers = Arc::clone(&servers);
        thread::spawn(move || {
            if let Err(e) = handle(req, servers) {
                eprintln!("[uniqus-agent] handler error: {}", e);
            }
        });
    }
}

/// Bring up eth0 from /proc/cmdline. Most Firecracker CI kernels are built
/// without CONFIG_IP_PNP, so the kernel's `ip=` cmdline is silently ignored.
/// We pass `uniqus_ip=<addr>/<prefix>` and `uniqus_gw=<addr>` and apply them
/// here via iproute2 (baked into the rootfs).
fn configure_network() {
    let cmdline = match fs::read_to_string("/proc/cmdline") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[uniqus-agent] could not read /proc/cmdline: {}", e);
            return;
        }
    };
    let extract = |key: &str| -> Option<String> {
        cmdline
            .split_ascii_whitespace()
            .find(|tok| tok.starts_with(&format!("{}=", key)))
            .map(|tok| tok[key.len() + 1..].to_string())
    };
    let ip = extract("uniqus_ip");
    let gw = extract("uniqus_gw");
    let (ip, gw) = match (ip, gw) {
        (Some(a), Some(b)) => (a, b),
        _ => {
            eprintln!(
                "[uniqus-agent] uniqus_ip/uniqus_gw missing from /proc/cmdline; \
                 eth0 will not be configured. cmdline={}",
                cmdline.trim()
            );
            return;
        }
    };
    let run = |cmd: &str, args: &[&str]| {
        let out = Command::new(cmd).args(args).output();
        match out {
            Ok(o) if o.status.success() => {
                eprintln!("[uniqus-agent] {} {} ok", cmd, args.join(" "));
                true
            }
            Ok(o) => {
                eprintln!(
                    "[uniqus-agent] {} {} → {} {}",
                    cmd,
                    args.join(" "),
                    o.status,
                    String::from_utf8_lossy(&o.stderr).trim()
                );
                false
            }
            Err(e) => {
                eprintln!("[uniqus-agent] {} spawn failed: {}", cmd, e);
                false
            }
        }
    };
    run("ip", &["link", "set", "lo", "up"]);
    run("ip", &["link", "set", "eth0", "up"]);
    run("ip", &["addr", "add", &ip, "dev", "eth0"]);
    run("ip", &["route", "add", "default", "via", &gw, "dev", "eth0"]);
    eprintln!("[uniqus-agent] eth0 configured: ip={} gw={}", ip, gw);
}

fn handle(mut req: Request, servers: ServerTable) -> std::io::Result<()> {
    let url = req.url().to_string();
    let method = req.method().clone();
    let (path, query) = split_url(&url);

    let result: Result<Response<std::io::Cursor<Vec<u8>>>, AgentError> = (|| {
        match (&method, path.as_str()) {
            (Method::Get, "/health") => Ok(json_response(200, &json!({ "ok": true, "kind": "rust" }))),
            (Method::Get, "/fs/file") => {
                let p = require_query(&query, "path")?;
                let full = resolve_sandbox(&p)?;
                let content = fs::read_to_string(&full)
                    .map_err(|e| AgentError::Io(format!("read {}: {}", p, e)))?;
                Ok(json_response(200, &json!({ "content": content })))
            }
            (Method::Put, "/fs/file") => {
                let body = read_body(&mut req)?;
                let p = require_str(&body, "path")?;
                let full = resolve_sandbox(&p)?;
                if let Some(parent) = full.parent() {
                    fs::create_dir_all(parent).map_err(|e| AgentError::Io(e.to_string()))?;
                }
                let raw = body.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let bytes = if body.get("encoding").and_then(|v| v.as_str()) == Some("base64") {
                    base64_decode(raw)
                        .map_err(|e| AgentError::Bad(format!("base64 decode: {}", e)))?
                } else {
                    raw.as_bytes().to_vec()
                };
                fs::write(&full, &bytes).map_err(|e| AgentError::Io(e.to_string()))?;
                Ok(json_response(200, &json!({ "ok": true })))
            }
            (Method::Post, "/fs/edit") => {
                let body = read_body(&mut req)?;
                let p = require_str(&body, "path")?;
                let old_s = require_str(&body, "old_string")?;
                let new_s = require_str(&body, "new_string")?;
                let full = resolve_sandbox(&p)?;
                let content = fs::read_to_string(&full)
                    .map_err(|e| AgentError::Io(format!("read {}: {}", p, e)))?;
                let occ = content.matches(&old_s).count();
                if occ == 0 {
                    return Err(AgentError::Bad(format!("old_string not found in {}", p)));
                }
                if occ > 1 {
                    return Err(AgentError::Bad(format!(
                        "old_string is not unique in {} ({} matches)",
                        p, occ
                    )));
                }
                let updated = content.replacen(&old_s, &new_s, 1);
                fs::write(&full, updated).map_err(|e| AgentError::Io(e.to_string()))?;
                Ok(json_response(200, &json!({ "ok": true })))
            }
            (Method::Get, "/fs/dir") => {
                let dir = match query.get("path") {
                    Some(p) if !p.is_empty() => resolve_sandbox(p)?,
                    _ => sandbox_dir(),
                };
                let mut entries = Vec::new();
                for entry in
                    fs::read_dir(&dir).map_err(|e| AgentError::Io(e.to_string()))?
                {
                    let entry = entry.map_err(|e| AgentError::Io(e.to_string()))?;
                    let name = entry.file_name().to_string_lossy().to_string();
                    let kind = entry
                        .file_type()
                        .map_err(|e| AgentError::Io(e.to_string()))?;
                    entries.push(if kind.is_dir() { format!("{}/", name) } else { name });
                }
                Ok(json_response(200, &json!({ "entries": entries })))
            }
            (Method::Post, "/fs/grep") => {
                let body = read_body(&mut req)?;
                let pattern = require_str(&body, "pattern")?;
                let sub = body.get("path").and_then(|v| v.as_str()).map(str::to_string);
                let matches = grep_walk(&pattern, sub.as_deref())?;
                Ok(json_response(200, &json!({ "matches": matches })))
            }
            (Method::Post, "/exec/run") => {
                let body = read_body(&mut req)?;
                let command = require_str(&body, "command")?;
                let timeout_ms = body
                    .get("timeout_ms")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(60_000);
                let result = run_command(&command, timeout_ms);
                Ok(json_response(200, &result))
            }
            (Method::Post, "/exec/start-server") => {
                let body = read_body(&mut req)?;
                let command = require_str(&body, "command")?;
                let port = body
                    .get("port")
                    .and_then(|v| v.as_u64())
                    .ok_or_else(|| AgentError::Bad("port is required".into()))?
                    as u16;
                let ready = body
                    .get("ready_timeout_ms")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(60_000);
                let r = start_server(&servers, &command, port, ready)?;
                Ok(json_response(200, &r))
            }
            (Method::Post, "/exec/stop-server") => {
                let body = read_body(&mut req)?;
                let id = require_str(&body, "id")?;
                stop_server(&servers, &id);
                Ok(json_response(200, &json!({ "ok": true })))
            }
            (Method::Get, "/exec/server-log") => {
                let id = require_query(&query, "id")?;
                let max = query
                    .get("max_bytes")
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(8000);
                let table = servers.lock().unwrap();
                let s = table
                    .get(&id)
                    .ok_or_else(|| AgentError::NotFound(format!("no server {}", id)))?;
                let log = s.log.lock().unwrap();
                let tail = if log.len() > max {
                    log[log.len() - max..].to_string()
                } else {
                    log.clone()
                };
                Ok(json_response(200, &json!({ "log": tail })))
            }
            _ => Err(AgentError::NotFound("not found".into())),
        }
    })();

    match result {
        Ok(resp) => req.respond(resp),
        Err(e) => req.respond(error_response(&e)),
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

#[derive(Debug)]
enum AgentError {
    Bad(String),
    NotFound(String),
    Io(String),
}

impl AgentError {
    fn status(&self) -> u16 {
        match self {
            AgentError::Bad(_) => 400,
            AgentError::NotFound(_) => 404,
            AgentError::Io(_) => 500,
        }
    }
    fn message(&self) -> &str {
        match self {
            AgentError::Bad(m) | AgentError::NotFound(m) | AgentError::Io(m) => m,
        }
    }
}

fn error_response(err: &AgentError) -> Response<std::io::Cursor<Vec<u8>>> {
    json_response(err.status(), &json!({ "error": err.message() }))
}

fn json_response<T: serde::Serialize>(status: u16, body: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    Response::from_data(bytes)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
}

fn read_body(req: &mut Request) -> Result<Value, AgentError> {
    let mut buf = String::new();
    req.as_reader()
        .read_to_string(&mut buf)
        .map_err(|e| AgentError::Bad(format!("read body: {}", e)))?;
    if buf.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&buf).map_err(|e| AgentError::Bad(format!("invalid JSON: {}", e)))
}

fn require_str(body: &Value, key: &str) -> Result<String, AgentError> {
    body.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| AgentError::Bad(format!("'{}' is required and must be a string", key)))
}

fn require_query(query: &HashMap<String, String>, key: &str) -> Result<String, AgentError> {
    query
        .get(key)
        .cloned()
        .ok_or_else(|| AgentError::Bad(format!("query param '{}' is required", key)))
}

fn split_url(url: &str) -> (String, HashMap<String, String>) {
    let (path, qs) = match url.split_once('?') {
        Some((p, q)) => (p.to_string(), q),
        None => (url.to_string(), ""),
    };
    let mut out = HashMap::new();
    for pair in qs.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        out.insert(url_decode(k), url_decode(v));
    }
    (path, out)
}

fn url_decode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                match (hi, lo) {
                    (Some(h), Some(l)) => {
                        out.push(((h << 4) | l) as u8);
                        i += 3;
                    }
                    _ => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolve a sandbox-relative path; reject anything that escapes via `..`.
fn resolve_sandbox(rel: &str) -> Result<PathBuf, AgentError> {
    let root = sandbox_dir();
    let candidate = if Path::new(rel).is_absolute() {
        PathBuf::from(rel)
    } else {
        root.join(rel)
    };
    let mut normalized = PathBuf::new();
    for comp in candidate.components() {
        match comp {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(AgentError::Bad(format!("path escapes sandbox: {}", rel)));
                }
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    let root_canon = root.canonicalize().unwrap_or(root.clone());
    if normalized != root_canon && !normalized.starts_with(&root_canon) {
        // Allow paths under the original (uncanonicalized) root too.
        if normalized != root && !normalized.starts_with(&root) {
            return Err(AgentError::Bad(format!("path escapes sandbox: {}", rel)));
        }
    }
    Ok(normalized)
}

fn truncate_for_response(s: &str) -> String {
    if s.len() <= HALF_MAX * 2 {
        return s.to_string();
    }
    let head = &s[..HALF_MAX];
    let tail = &s[s.len() - HALF_MAX..];
    let dropped = s.len() - HALF_MAX * 2;
    format!(
        "{}\n\n[... truncated {} bytes ...]\n\n{}",
        head, dropped, tail
    )
}

fn grep_walk(pattern: &str, sub: Option<&str>) -> Result<String, AgentError> {
    let re = Regex::new(pattern)
        .map_err(|e| AgentError::Bad(format!("invalid regex: {}", e)))?;
    let root = sandbox_dir();
    let target = match sub {
        Some(p) if !p.is_empty() => resolve_sandbox(p)?,
        _ => root.clone(),
    };
    let mut out: Vec<String> = Vec::new();
    walk(&target, &root, &re, &mut out);
    Ok(if out.is_empty() {
        "(no matches)".to_string()
    } else {
        out.join("\n")
    })
}

fn walk(dir: &Path, root: &Path, re: &Regex, out: &mut Vec<String>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "node_modules" || name_str.starts_with('.') {
            continue;
        }
        let full = entry.path();
        let kind = match entry.file_type() {
            Ok(k) => k,
            Err(_) => continue,
        };
        if kind.is_dir() {
            walk(&full, root, re, out);
            continue;
        }
        let text = match fs::read_to_string(&full) {
            Ok(t) => t,
            Err(_) => continue, // binary or unreadable
        };
        for (i, line) in text.lines().enumerate() {
            if re.is_match(line) {
                let rel = full.strip_prefix(root).unwrap_or(&full);
                out.push(format!(
                    "{}:{}: {}",
                    rel.display(),
                    i + 1,
                    line.trim()
                ));
            }
        }
    }
}

fn run_command(command: &str, timeout_ms: u64) -> Value {
    let mut child = match Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(sandbox_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return json!({
                "stdout": "",
                "stderr": format!("[spawn error] {}", e),
                "exitCode": 1,
            });
        }
    };

    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();
    let stdout_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let stderr_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let so = Arc::clone(&stdout_buf);
    let se = Arc::clone(&stderr_buf);
    let stdout_thread = stdout_handle.map(|mut h| {
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = h.read(&mut buf) {
                if n == 0 {
                    break;
                }
                so.lock().unwrap().extend_from_slice(&buf[..n]);
            }
        })
    });
    let stderr_thread = stderr_handle.map(|mut h| {
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = h.read(&mut buf) {
                if n == 0 {
                    break;
                }
                se.lock().unwrap().extend_from_slice(&buf[..n]);
            }
        })
    });

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let exit_status = wait_with_timeout(&mut child, deadline);
    let killed_by_timeout = exit_status.is_none();
    if killed_by_timeout {
        let _ = child.kill();
    }
    if let Some(t) = stdout_thread {
        let _ = t.join();
    }
    if let Some(t) = stderr_thread {
        let _ = t.join();
    }
    let status = exit_status.unwrap_or_else(|| {
        // Reap the killed child to avoid a zombie.
        child.wait().unwrap_or(ExitStatus::from_raw(137 << 8))
    });

    let mut stdout_str = String::from_utf8_lossy(&stdout_buf.lock().unwrap()).into_owned();
    let mut stderr_str = String::from_utf8_lossy(&stderr_buf.lock().unwrap()).into_owned();
    if killed_by_timeout {
        stderr_str.push_str(&format!("\n[killed: timeout after {}ms]", timeout_ms));
    }
    stdout_str = truncate_for_response(&stdout_str);
    stderr_str = truncate_for_response(&stderr_str);
    let exit_code = status.code();
    json!({
        "stdout": stdout_str,
        "stderr": stderr_str,
        "exitCode": exit_code,
    })
}

/// Poll-wait for a child up to `deadline`. Returns Some(status) if the child
/// exited, None if we hit the deadline first.
fn wait_with_timeout(child: &mut Child, deadline: Instant) -> Option<ExitStatus> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {}
            Err(_) => return None,
        }
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn start_server(
    servers: &ServerTable,
    command: &str,
    port: u16,
    ready_timeout_ms: u64,
) -> Result<Value, AgentError> {
    let id = format!("srv_{}", random_hex(8));
    let mut child = Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(sandbox_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AgentError::Io(format!("spawn server: {}", e)))?;
    let pid = child.id();
    let log = Arc::new(Mutex::new(String::new()));
    spawn_log_pump(child.stdout.take(), Arc::clone(&log));
    spawn_log_pump(child.stderr.take(), Arc::clone(&log));

    {
        let mut table = servers.lock().unwrap();
        table.insert(
            id.clone(),
            ManagedServer {
                pid,
                port,
                child,
                log: Arc::clone(&log),
            },
        );
    }
    // Reaper: when the child exits on its own, delete the entry. We don't
    // hold the Child here (it lives in the table) — instead we poll cheaply.
    {
        let servers = Arc::clone(servers);
        let id = id.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(500));
            let mut table = servers.lock().unwrap();
            let Some(entry) = table.get_mut(&id) else {
                return;
            };
            match entry.child.try_wait() {
                Ok(Some(_)) => {
                    table.remove(&id);
                    return;
                }
                Ok(None) => {}
                Err(_) => return,
            }
        });
    }

    if !wait_for_port(port, Duration::from_millis(ready_timeout_ms)) {
        let log_tail = log.lock().unwrap().clone();
        // Kill it; the reaper will clear the entry on its next tick, but we
        // can also remove it now to avoid handing a half-dead handle back.
        if let Some(mut entry) = servers.lock().unwrap().remove(&id) {
            let _ = entry.child.kill();
        }
        let tail = if log_tail.len() > 1500 {
            log_tail[log_tail.len() - 1500..].to_string()
        } else {
            log_tail
        };
        return Err(AgentError::Bad(format!(
            "server did not open port {} within {}ms\nrecent log:\n{}",
            port, ready_timeout_ms, tail
        )));
    }
    Ok(json!({ "id": id, "pid": pid, "port": port }))
}

fn spawn_log_pump(reader: Option<impl Read + Send + 'static>, sink: Arc<Mutex<String>>) {
    let Some(mut reader) = reader else { return };
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let chunk = String::from_utf8_lossy(&buf[..n]);
            let mut log = sink.lock().unwrap();
            log.push_str(&chunk);
            if log.len() > MAX_LOG {
                let drop = log.len() - MAX_LOG;
                log.replace_range(..drop, "");
            }
        }
    });
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(stream) = TcpStream::connect_timeout(
            &([127, 0, 0, 1], port).into(),
            Duration::from_millis(200),
        ) {
            let _ = stream.shutdown(Shutdown::Both);
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

fn stop_server(servers: &ServerTable, id: &str) {
    let mut table = servers.lock().unwrap();
    if let Some(mut entry) = table.remove(id) {
        let _ = entry.child.kill();
    }
}

/// `srv_<8-hex>` ids. Read from /dev/urandom — a few bytes is fine.
fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    if let Ok(mut f) = File::open("/dev/urandom") {
        let _ = f.read_exact(&mut buf);
    }
    let mut s = String::with_capacity(bytes * 2);
    for b in buf {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Tiny base64 decoder — we only need it for `/fs/file` PUT with
/// `encoding=base64`. Pulling in the `base64` crate for ~30 lines isn't
/// worth the binary-size cost; this matches the standard alphabet exactly.
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    const TABLE: [i8; 256] = {
        let mut t = [-1i8; 256];
        let alpha = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < alpha.len() {
            t[alpha[i] as usize] = i as i8;
            i += 1;
        }
        t
    };
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let stripped: Vec<u8> = bytes.iter().copied().filter(|b| *b != b'=').collect();
    let mut out = Vec::with_capacity(stripped.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for b in stripped {
        let v = TABLE[b as usize];
        if v < 0 {
            return Err(format!("invalid char {:?}", b as char));
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

// We don't ship a Cargo workspace, so tests run with `cargo test --manifest-path
// services/sandbox-agent/Cargo.toml`. Kept minimal — the wire format is
// covered by the orchestrator's integration tests against a live VM.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_decode_basic() {
        assert_eq!(url_decode("hello%20world"), "hello world");
        assert_eq!(url_decode("a+b=c"), "a b=c");
        assert_eq!(url_decode("plain"), "plain");
    }

    #[test]
    fn split_url_query() {
        let (p, q) = split_url("/fs/file?path=foo%2Fbar&max_bytes=100");
        assert_eq!(p, "/fs/file");
        assert_eq!(q.get("path"), Some(&"foo/bar".to_string()));
        assert_eq!(q.get("max_bytes"), Some(&"100".to_string()));
    }

    #[test]
    fn base64_decode_roundtrip() {
        // "uniqus" → "dW5pcXVz"
        assert_eq!(base64_decode("dW5pcXVz").unwrap(), b"uniqus");
        // "hello world!" → "aGVsbG8gd29ybGQh"
        assert_eq!(
            base64_decode("aGVsbG8gd29ybGQh").unwrap(),
            b"hello world!"
        );
    }
}
