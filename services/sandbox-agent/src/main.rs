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
//   GET  /fs/file?path=…             → { content } (+&encoding=base64 → { content, encoding: "base64" };
//                                       +&offset=&limit= line range → { content, total_lines })
//   PUT  /fs/file                    body: { path, content, encoding? }
//   GET  /fs/manifest                → { files: [{ path, size, mtime_ms }] } (storage-sync exclusions applied)
//   POST /fs/edit                    body: { path, old_string, new_string }
//   GET  /fs/dir?path=…              → { entries }
//   POST /fs/grep                    body: { pattern, path?, case_insensitive?, literal? } → { matches }
//   POST /exec/run                   body: { command, timeout_ms } → { stdout, stderr, exitCode }
//   POST /exec/start-server          body: { command, port, ready_timeout_ms } → { id, pid, port }
//   POST /exec/stop-server           body: { id }
//   GET  /exec/server-log?id=…       → { log }

use regex::{Regex, RegexBuilder};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::os::unix::process::{CommandExt, ExitStatusExt};
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

    // Package-manager caches must NOT land in $HOME: on a golden-snapshot clone
    // the rootfs is mounted READ-ONLY (/root is a small tmpfs at best), and a
    // RAM-backed cache can OOM a 1 GiB guest on a big install. Point npm/yarn/
    // pnpm at the per-project /sandbox disk — ".cache" is excluded from storage
    // sync, the VM→host pull, and /fs/manifest, and it persists across VM
    // restarts. Every child we spawn inherits this env. Mirrors agent.mjs
    // (mirror any change into BOTH agents).
    if std::env::var_os("npm_config_cache").is_none() {
        std::env::set_var("npm_config_cache", dir.join(".cache/npm"));
    }
    if std::env::var_os("YARN_CACHE_FOLDER").is_none() {
        std::env::set_var("YARN_CACHE_FOLDER", dir.join(".cache/yarn"));
    }
    if std::env::var_os("npm_config_store_dir").is_none() {
        std::env::set_var("npm_config_store_dir", dir.join(".cache/pnpm-store"));
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
    // F1/P0.2: the bearer token required on every request (None ⇒ not enforced).
    // Wrapped in a Mutex (not a plain Arc<Option>) because a golden-snapshot
    // clone resumes WITHOUT uniqus_auth on its frozen cmdline, then gets its
    // per-project token (re)provisioned via POST /net/configure at restore — so
    // the enforced token must be mutable at runtime, not read-once at boot.
    let auth: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(read_required_token()));
    if auth.lock().map(|g| g.is_some()).unwrap_or(false) {
        eprintln!("[uniqus-agent] request auth ENFORCED (per-VM bearer token)");
    }
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
        let auth = Arc::clone(&auth);
        thread::spawn(move || {
            if let Err(e) = handle(req, servers, auth) {
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
    // Cold boot: Firecracker already assigned the per-VM MAC via guest_mac, so
    // keep it (pass None) and just bring the link up with the cmdline address.
    apply_network(&ip, &gw, None);
    eprintln!("[uniqus-agent] eth0 configured from cmdline: ip={} gw={}", ip, gw);
}

/// F1: the per-VM bearer token the orchestrator must present on every request,
/// or None to NOT enforce. We enforce ONLY when `uniqus_auth=1` AND
/// `uniqus_token=<t>` are both on the cmdline — so the token can ship dark
/// (provisioned + sent but not enforced) until it's validated on the host.
fn read_required_token() -> Option<String> {
    let cmdline = fs::read_to_string("/proc/cmdline").ok()?;
    let enforced = cmdline.split_ascii_whitespace().any(|t| t == "uniqus_auth=1");
    if !enforced {
        return None;
    }
    cmdline
        .split_ascii_whitespace()
        .find(|tok| tok.starts_with("uniqus_token="))
        .map(|tok| tok["uniqus_token=".len()..].to_string())
}

/// Run a host command, logging the outcome. Returns whether it succeeded.
fn run_cmd(cmd: &str, args: &[&str]) -> bool {
    match Command::new(cmd).args(args).output() {
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
}

/// Apply a static config to eth0. `ip` is "addr/prefix" (e.g. 172.16.3.4/16),
/// `gw` the default gateway. If `mac` is given it is set while the link is DOWN
/// (required to change a MAC). Idempotent: addresses + routes on eth0 are
/// flushed first so re-running — a snapshot restore over a golden image whose
/// eth0 was left down, or a re-stamp — always converges instead of stacking
/// addresses/routes.
fn apply_network(ip: &str, gw: &str, mac: Option<&str>) {
    run_cmd("ip", &["link", "set", "eth0", "down"]);
    if let Some(mac) = mac {
        run_cmd("ip", &["link", "set", "dev", "eth0", "address", mac]);
    }
    run_cmd("ip", &["addr", "flush", "dev", "eth0"]);
    run_cmd("ip", &["route", "flush", "dev", "eth0"]);
    run_cmd("ip", &["link", "set", "lo", "up"]);
    run_cmd("ip", &["link", "set", "eth0", "up"]);
    run_cmd("ip", &["addr", "add", ip, "dev", "eth0"]);
    run_cmd("ip", &["route", "add", "default", "via", gw, "dev", "eth0"]);
    eprintln!(
        "[uniqus-agent] eth0 set: ip={} gw={} mac={}",
        ip,
        gw,
        mac.unwrap_or("(unchanged)")
    );
}

/// Mix orchestrator-supplied entropy into the guest RNG so clones restored from
/// one base snapshot don't share an identical /dev/urandom stream. `seed` is
/// base64 (falls back to raw bytes). Best-effort.
fn reseed_urandom(seed: &str) {
    let bytes = base64_decode(seed).unwrap_or_else(|_| seed.as_bytes().to_vec());
    if bytes.is_empty() {
        return;
    }
    match fs::OpenOptions::new().write(true).open("/dev/urandom") {
        Ok(mut f) => {
            let _ = f.write_all(&bytes);
            eprintln!("[uniqus-agent] reseeded /dev/urandom with {} bytes", bytes.len());
        }
        Err(e) => eprintln!("[uniqus-agent] reseed /dev/urandom failed: {}", e),
    }
}

/// Set the wall clock from epoch millis. Clones resume holding the snapshot's
/// frozen clock; a stale clock breaks TLS, npm, and git. BusyBox `date -s`.
fn set_clock_ms(ms: u64) {
    let secs = ms / 1000;
    run_cmd("date", &["-s", &format!("@{}", secs)]);
}

/// Mount the per-project sandbox volume (/dev/vdb) at the sandbox dir on a
/// base-snapshot restore. The golden image left it unmounted, and the backing
/// file is this project's own ext4 (already formatted host-side), so a fresh
/// mount reads the correct superblock — no stale page-cache from the golden's
/// placeholder disk. Idempotent enough: if something is already mounted there a
/// second mount just fails harmlessly and we keep serving the existing one.
fn mount_sandbox() {
    let dir = sandbox_dir();
    let dir = dir.to_string_lossy();
    let _ = fs::create_dir_all(&*dir);
    run_cmd("mount", &["-t", "ext4", "/dev/vdb", &*dir]);
}

fn handle(
    mut req: Request,
    servers: ServerTable,
    auth: Arc<Mutex<Option<String>>>,
) -> std::io::Result<()> {
    let url = req.url().to_string();
    let method = req.method().clone();
    let (path, query) = split_url(&url);

    // F1: require the per-VM bearer token on every endpoint except /health (an
    // unauthenticated readiness probe the orchestrator pings before attaching
    // the token). The required token is None when enforcement is off — true on a
    // golden clone only until /net/configure provisions it (P0.2). Snapshot the
    // value and drop the lock before the work below.
    if path != "/health" {
        let required = auth.lock().ok().and_then(|g| g.clone());
        if let Some(required) = required {
            let expected = format!("Bearer {}", required);
            // C-115: constant-time comparison of the presented token against the
            // expected value so a bridge-local attacker can't recover it byte by
            // byte from response timing. `any` short-circuits on the header match,
            // but the value compare itself (constant_time_eq) must not.
            let ok = req.headers().iter().any(|h| {
                h.field.equiv("Authorization")
                    && constant_time_eq(h.value.as_str().as_bytes(), expected.as_bytes())
            });
            if !ok {
                return req.respond(json_response(401, &json!({ "error": "unauthorized" })));
            }
        }
    }

    let result: Result<Response<std::io::Cursor<Vec<u8>>>, AgentError> = (|| {
        match (&method, path.as_str()) {
            (Method::Get, "/health") => Ok(json_response(200, &json!({ "ok": true, "kind": "rust" }))),
            (Method::Post, "/net/configure") => {
                // Used on a base-snapshot restore: the golden snapshot freezes
                // eth0 DOWN with a placeholder MAC, identical across every clone.
                // The orchestrator calls this right after resume to stamp THIS
                // project's unique MAC + IP + route before the link goes up, so
                // there is never a moment where two clones share a MAC/IP on the
                // bridge. Also (best-effort) de-correlates clock + RNG state that
                // would otherwise be identical across clones.
                let body = read_body(&mut req)?;
                let ip = require_str(&body, "ip")?;
                let gw = require_str(&body, "gw")?;
                let mac = body.get("mac").and_then(|v| v.as_str()).map(str::to_string);
                // P0.2: (re)provision + ENFORCE this clone's per-project bearer
                // token. A golden clone resumes unauthenticated (its frozen
                // cmdline omits uniqus_auth); this is the moment it adopts the
                // same token a cold-booted VM would have had from boot. After
                // this, every later request — including a retry of THIS call —
                // must present the token (finalizeRestore sends it as a Bearer).
                if body.get("uniqus_auth").and_then(|v| v.as_bool()).unwrap_or(false) {
                    if let Some(token) = body.get("auth_token").and_then(|v| v.as_str()) {
                        if let Ok(mut g) = auth.lock() {
                            *g = Some(token.to_string());
                        }
                        eprintln!(
                            "[uniqus-agent] request auth ENFORCED via /net/configure (golden restore)"
                        );
                    }
                }
                // These don't disturb the link we're replying over, so do them now:
                // mount the project's sandbox drive (golden left it unmounted; the
                // drive was repointed at this project's image via the relative path
                // resolved against this firecracker's cwd before resume), then
                // de-correlate clock + RNG.
                if body.get("mount_sandbox").and_then(|v| v.as_bool()).unwrap_or(false) {
                    mount_sandbox();
                }
                if let Some(seed) = body.get("seed").and_then(|v| v.as_str()) {
                    reseed_urandom(seed);
                }
                if let Some(ms) = body.get("time_ms").and_then(|v| v.as_u64()) {
                    set_clock_ms(ms);
                }
                // Re-stamp eth0 only AFTER this response is flushed: apply_network
                // takes the link DOWN and changes the MAC, which would kill the very
                // connection we're answering over (we're reachable here only on the
                // shared bootstrap IP). The orchestrator then finds us on the new
                // per-project IP and releases the bootstrap lock. 50ms is plenty for
                // a sub-ms L2 hop to drain the reply; this delay sits on every
                // golden-restore boot (under the orchestrator's bootstrap lock), so
                // the old 250ms added a fifth of a second to every reopen.
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(50));
                    apply_network(&ip, &gw, mac.as_deref());
                });
                Ok(json_response(200, &json!({ "ok": true, "restamp": "scheduled" })))
            }
            (Method::Get, "/fs/file") => {
                let p = require_query(&query, "path")?;
                let full = resolve_sandbox(&p)?;
                // Binary-safe read for the VM→host pull (C-18). Echoing
                // `encoding` back is the capability signal — agents without
                // this support reply without it, so the orchestrator falls
                // back to an exec-based read instead of corrupting binaries.
                if query.get("encoding").map(String::as_str) == Some("base64") {
                    let bytes = fs::read(&full)
                        .map_err(|e| AgentError::Io(format!("read {}: {}", p, e)))?;
                    Ok(json_response(
                        200,
                        &json!({ "content": base64_encode(&bytes), "encoding": "base64" }),
                    ))
                } else {
                    let content = fs::read_to_string(&full)
                        .map_err(|e| AgentError::Io(format!("read {}: {}", p, e)))?;
                    // Line-range read: slice in-guest so we don't ship a huge
                    // file across RPC just to window it. We split on '\n' (a
                    // trailing newline yields a phantom empty last line) so the
                    // total_lines count matches the orchestrator/host counting.
                    let offset = query.get("offset").and_then(|s| s.parse::<usize>().ok());
                    let limit = query.get("limit").and_then(|s| s.parse::<usize>().ok());
                    if offset.is_some() || limit.is_some() {
                        let lines: Vec<&str> = content.split('\n').collect();
                        let total = lines.len();
                        let start = offset.unwrap_or(1).max(1);
                        let count = limit.unwrap_or(2000).max(1);
                        let sliced = if start > total {
                            String::new()
                        } else {
                            let end = (start - 1 + count).min(total);
                            lines[start - 1..end].join("\n")
                        };
                        Ok(json_response(
                            200,
                            &json!({ "content": sliced, "total_lines": total }),
                        ))
                    } else {
                        Ok(json_response(200, &json!({ "content": content })))
                    }
                }
            }
            (Method::Get, "/fs/manifest") => {
                Ok(json_response(200, &json!({ "files": build_manifest() })))
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
                let ci = body
                    .get("case_insensitive")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let literal = body.get("literal").and_then(|v| v.as_bool()).unwrap_or(false);
                let matches = grep_walk(&pattern, sub.as_deref(), ci, literal)?;
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
                // Char-boundary-safe: a raw byte slice here would panic on a
                // non-boundary offset, and we hold BOTH the servers table lock
                // and the per-server log lock — under panic=abort that aborts
                // the whole agent (no poisoning, but the VM's RPC dies).
                let tail = tail_str(&log, max).to_string();
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

/// Constant-time byte comparison (C-115). Always folds over the full expected
/// length so the loop count doesn't reveal where a mismatch is; the length
/// check is combined into the accumulator rather than short-circuiting. Not for
/// cryptographic secrets at scale, but enough to deny a timing oracle on the
/// per-VM bearer token.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    // Differing length is itself a mismatch, but we still want to do the same
    // amount of work regardless: walk `b` (the fixed-length expected value) and
    // index `a` modulo its length so the iteration count never depends on `a`.
    let mut diff: u8 = (a.len() != b.len()) as u8;
    if !a.is_empty() {
        for (i, &bb) in b.iter().enumerate() {
            diff |= a[i % a.len()] ^ bb;
        }
    } else {
        // `a` empty: still touch every byte of `b` to keep timing flat.
        for &bb in b {
            diff |= bb;
        }
    }
    diff == 0
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

/// Largest char boundary <= `i` (i clamped to s.len()). Walks down at most 3
/// bytes — a UTF-8 char is at most 4 bytes — so this is O(1). Implemented by
/// hand because `str::floor_char_boundary` is still unstable on stable Rust;
/// slicing a `String` at a non-boundary byte index panics, which under
/// `panic = "abort"` (Cargo.toml) would abort the whole agent and brick the VM.
fn floor_boundary(s: &str, i: usize) -> usize {
    let mut i = i.min(s.len());
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Smallest char boundary >= `i` (i clamped to s.len()). Counterpart to
/// `floor_boundary`, used for the tail offset of a truncation.
fn ceil_boundary(s: &str, i: usize) -> usize {
    let mut i = i.min(s.len());
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// Char-boundary-safe tail: the suffix of `s` no longer than `max` bytes,
/// snapped up to the nearest char boundary so the slice never splits a
/// multibyte char (which would panic → abort under `panic = "abort"`).
fn tail_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let start = ceil_boundary(s, s.len() - max);
    &s[start..]
}

fn truncate_for_response(s: &str) -> String {
    if s.len() <= HALF_MAX * 2 {
        return s.to_string();
    }
    let head_end = floor_boundary(s, HALF_MAX);
    let tail_start = ceil_boundary(s, s.len() - HALF_MAX);
    let head = &s[..head_end];
    let tail = &s[tail_start..];
    let dropped = s.len() - head.len() - tail.len();
    format!(
        "{}\n\n[... truncated {} bytes ...]\n\n{}",
        head, dropped, tail
    )
}

/// /fs/manifest walk (C-18 VM→host pull). The skip list mirrors the
/// orchestrator's storage-sync exclusions (storage/sync.ts SKIP_DIRS) so the
/// pull diff and the Storage push agree on what counts as project state.
/// Mirrors buildManifest in agent.mjs — wire format must stay identical.
const MANIFEST_SKIP_DIRS: [&str; 15] = [
    "node_modules", ".git", ".next", ".turbo", ".cache", "dist", "build", "out",
    "coverage", "__pycache__", ".pytest_cache", "target", "vendor", ".venv", "venv",
];
const MANIFEST_MAX_FILES: usize = 20_000;

fn build_manifest() -> Vec<serde_json::Value> {
    let root = sandbox_dir();
    let mut files = Vec::new();
    manifest_walk(&root, &root, &mut files);
    files
}

fn manifest_walk(dir: &Path, root: &Path, out: &mut Vec<serde_json::Value>) {
    if out.len() >= MANIFEST_MAX_FILES {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if out.len() >= MANIFEST_MAX_FILES {
            return;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if MANIFEST_SKIP_DIRS.contains(&name_str.as_ref()) {
            continue;
        }
        let kind = match entry.file_type() {
            Ok(k) => k,
            Err(_) => continue,
        };
        let full = entry.path();
        if kind.is_dir() {
            manifest_walk(&full, root, out);
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let rel = full.strip_prefix(root).unwrap_or(&full);
        out.push(json!({
            "path": rel.to_string_lossy().replace('\\', "/"),
            "size": meta.len(),
            "mtime_ms": mtime_ms,
        }));
    }
}

/// A grep matcher: a compiled regex, or a (case-aware) literal substring. The
/// literal arm is used when `literal` is requested OR when the pattern won't
/// compile as a regex — so grep degrades to a substring search instead of
/// erroring, matching what the model expects from shell grep.
enum Matcher {
    Re(Regex),
    Literal { needle: String, ci: bool },
}

impl Matcher {
    fn is_match(&self, line: &str) -> bool {
        match self {
            Matcher::Re(re) => re.is_match(line),
            Matcher::Literal { needle, ci } => {
                if *ci {
                    line.to_lowercase().contains(needle)
                } else {
                    line.contains(needle)
                }
            }
        }
    }
}

fn literal_matcher(pattern: &str, ci: bool) -> Matcher {
    Matcher::Literal {
        needle: if ci { pattern.to_lowercase() } else { pattern.to_string() },
        ci,
    }
}

fn grep_walk(
    pattern: &str,
    sub: Option<&str>,
    ci: bool,
    literal: bool,
) -> Result<String, AgentError> {
    let mut fell_back = false;
    let matcher = if literal {
        literal_matcher(pattern, ci)
    } else {
        match RegexBuilder::new(pattern).case_insensitive(ci).build() {
            Ok(re) => Matcher::Re(re),
            Err(_) => {
                fell_back = true;
                literal_matcher(pattern, ci)
            }
        }
    };
    let root = sandbox_dir();
    let target = match sub {
        Some(p) if !p.is_empty() => resolve_sandbox(p)?,
        _ => root.clone(),
    };
    let mut out: Vec<String> = Vec::new();
    walk(&target, &root, &matcher, &mut out);
    let note = if fell_back {
        "[pattern is not a valid regex — searched as a literal substring]\n"
    } else {
        ""
    };
    Ok(if out.is_empty() {
        format!("{}(no matches)", note)
    } else {
        format!("{}{}", note, out.join("\n"))
    })
}

fn walk(dir: &Path, root: &Path, re: &Matcher, out: &mut Vec<String>) {
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

/// Per-stream byte cap for /exec/run. We keep draining the pipe past this so
/// the child never blocks on a full pipe, but stop *storing* bytes — otherwise
/// `cat /dev/zero` (or a chatty build) grows the buffer without bound and OOMs
/// the 1 GiB VM before the timeout fires. truncate_for_response shrinks it
/// further for the wire; this just bounds peak memory.
const RUN_OUTPUT_CAP: usize = 4 * 1024 * 1024;

fn run_command(command: &str, timeout_ms: u64) -> Value {
    let mut child = match Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(sandbox_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // C-60: own process group (PGID == child PID) so a timeout can SIGKILL
        // the whole tree, not just /bin/sh. Otherwise a daemonized grandchild
        // survives, keeps the inherited stdout/stderr write-ends open, and the
        // reader threads never see EOF — hanging their joins forever.
        .process_group(0)
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

    let pid = child.id();
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();
    let stdout_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let stderr_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let so = Arc::clone(&stdout_buf);
    let se = Arc::clone(&stderr_buf);
    let stdout_thread = stdout_handle.map(|h| spawn_capped_reader(h, so));
    let stderr_thread = stderr_handle.map(|h| spawn_capped_reader(h, se));

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let exit_status = wait_with_timeout(&mut child, deadline);
    let killed_by_timeout = exit_status.is_none();
    if killed_by_timeout {
        // Kill the entire process group, not just sh: -pid targets PGID `pid`.
        // SIGKILL closes every write-end of the pipes so the readers hit EOF.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
        // Belt and braces in case the group somehow doesn't cover sh itself.
        let _ = child.kill();
    }
    // On a timeout we must NOT block on the reader joins: if some grandchild
    // still (briefly) holds a write-end, join() would hang the handler. The
    // group-kill closes the pipes essentially immediately, so a short grace is
    // enough; past that we read whatever was buffered and let the (now near-
    // dead) reader threads finish detached. On the normal exit path we join
    // fully so all output is captured.
    if killed_by_timeout {
        join_or_detach(stdout_thread, Duration::from_millis(500));
        join_or_detach(stderr_thread, Duration::from_millis(500));
    } else {
        if let Some(t) = stdout_thread {
            let _ = t.join();
        }
        if let Some(t) = stderr_thread {
            let _ = t.join();
        }
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

/// Drain a child pipe into `sink`, but stop *storing* once `sink` reaches
/// RUN_OUTPUT_CAP bytes (C-61). We keep calling read() so the child doesn't
/// block on a full pipe; we just drop the bytes past the cap.
fn spawn_capped_reader(
    mut h: impl Read + Send + 'static,
    sink: Arc<Mutex<Vec<u8>>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut capped = false;
        while let Ok(n) = h.read(&mut buf) {
            if n == 0 {
                break;
            }
            if capped {
                continue; // keep draining, drop the bytes
            }
            let mut g = sink.lock().unwrap();
            let room = RUN_OUTPUT_CAP.saturating_sub(g.len());
            if room == 0 {
                capped = true;
                continue;
            }
            let take = n.min(room);
            g.extend_from_slice(&buf[..take]);
            if g.len() >= RUN_OUTPUT_CAP {
                capped = true;
            }
        }
    })
}

/// Try to join `thread` within `grace`; if it hasn't finished, detach it so the
/// caller never blocks. Used only on the timeout path after a group-kill, where
/// a lingering write-end could otherwise wedge the join indefinitely.
fn join_or_detach(thread: Option<thread::JoinHandle<()>>, grace: Duration) {
    let Some(t) = thread else { return };
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if t.is_finished() {
            let _ = t.join();
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    // Still running: leave it detached. Its sink is an Arc we still hold, so
    // reading the buffered output below stays memory-safe.
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
    // Free the port first so we truly take it over (a prior dev server can be
    // left holding it — a pre-fix orphan, or one started via run_command).
    clear_port(port);
    let mut child = Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(sandbox_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Own process group (PGID == child PID) so stop_server can SIGKILL the
        // whole tree (sh → npm → node), not just sh. Mirrors run_command —
        // killing only sh orphaned the grandchild node, which kept the port and
        // served stale code.
        .process_group(0)
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
            // Group-kill so a daemonized grandchild can't survive the failed start.
            unsafe {
                libc::kill(-(entry.pid as i32), libc::SIGKILL);
            }
            let _ = entry.child.kill();
        }
        let tail = tail_str(&log_tail, 1500).to_string();
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
                // Snap the cut up to a char boundary: replace_range on a
                // non-boundary index panics → abort under panic=abort.
                let drop = ceil_boundary(&log, log.len() - MAX_LOG);
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
        // Kill the whole process group (sh → npm → node), not just sh — the
        // grandchild node is what holds the port. -pid targets PGID == pid
        // because start_server spawned with process_group(0).
        unsafe {
            libc::kill(-(entry.pid as i32), libc::SIGKILL);
        }
        let _ = entry.child.kill();
    }
}

/// Is anyone accepting TCP connections on this port right now?
fn port_is_bound(port: u16) -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(200)).is_ok()
}

/// Free a TCP port before (re)binding. `ss` (iproute2, in the rootfs) reports the
/// holding pid; SIGKILL it and wait for the socket to release so the new server
/// doesn't hit EADDRINUSE (and the old one stops answering with stale code).
fn clear_port(port: u16) {
    if !port_is_bound(port) {
        return;
    }
    let snippet = format!(
        "for pid in $(ss -tlnpH \"sport = :{}\" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill -9 \"$pid\" 2>/dev/null || true; done",
        port
    );
    let _ = Command::new("/bin/sh").arg("-c").arg(&snippet).status();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline && port_is_bound(port) {
        thread::sleep(Duration::from_millis(150));
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
/// Std-only base64 encoder (no padding-free variants needed) — pairs with
/// base64_decode below for the binary-safe GET /fs/file?encoding=base64.
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHA: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHA[((triple >> 18) & 63) as usize] as char);
        out.push(ALPHA[((triple >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHA[((triple >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHA[(triple & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

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

    #[test]
    fn base64_encode_decode_roundtrip() {
        assert_eq!(base64_encode(b"uniqus"), "dW5pcXVz");
        assert_eq!(base64_encode(b"hello world!"), "aGVsbG8gd29ybGQh");
        // Padding variants (1 and 2 trailing bytes) + binary bytes survive a
        // full encode→decode loop — this is the path a pulled PNG rides.
        for input in [&b"a"[..], &b"ab"[..], &b"abc"[..], &[0u8, 255, 128, 7, 9][..]] {
            assert_eq!(base64_decode(&base64_encode(input)).unwrap(), input);
        }
    }

    // C-20/21/22: truncation must never panic on a multibyte char straddling
    // the cut. "→" is 3 bytes (E2 86 92); build inputs that put a boundary
    // mid-char and assert no panic + valid UTF-8 out.
    #[test]
    fn truncate_never_splits_multibyte() {
        // Each "a→" is 4 bytes; 5000 reps = 20_000 bytes > HALF_MAX*2 (16384),
        // and the 8192/len-8192 offsets land inside a "→".
        let s = "a→".repeat(5000);
        let out = truncate_for_response(&s);
        assert!(out.contains("truncated"));
        // String is valid UTF-8 by construction; the point is no panic above.
        assert!(out.len() < s.len());
    }

    #[test]
    fn truncate_short_passthrough() {
        let s = "→→→"; // 9 bytes, well under the cap
        assert_eq!(truncate_for_response(s), s);
    }

    #[test]
    fn tail_str_is_char_safe() {
        let s = "→".repeat(100); // 300 bytes
        // 100 is not a multiple of 3, so a raw byte slice at len-100 would split
        // a "→". tail_str must snap to a boundary and stay valid.
        let t = tail_str(&s, 100);
        assert!(t.len() <= 100);
        assert!(s.ends_with(t));
        // Whole-string request returns the whole string.
        assert_eq!(tail_str(&s, 10_000), &s);
    }

    #[test]
    fn char_boundary_helpers() {
        let s = "a→b"; // bytes: 0='a',1..=3='→',4='b'
        assert_eq!(floor_boundary(s, 2), 1);
        assert_eq!(ceil_boundary(s, 2), 4);
        assert_eq!(floor_boundary(s, 99), s.len());
        assert_eq!(ceil_boundary(s, 99), s.len());
    }

    #[test]
    fn constant_time_eq_matches_equality() {
        assert!(constant_time_eq(b"Bearer abc", b"Bearer abc"));
        assert!(!constant_time_eq(b"Bearer abc", b"Bearer abd"));
        assert!(!constant_time_eq(b"short", b"longer value"));
        assert!(!constant_time_eq(b"", b"x"));
        assert!(constant_time_eq(b"", b""));
    }
}
