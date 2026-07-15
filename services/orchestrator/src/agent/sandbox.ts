import {
  constants as fsConstants,
  createReadStream,
  promises as fs,
  existsSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import treeKill from "tree-kill";
import { safeChildEnv } from "../safeEnv.js";
import { assertHostSandboxAllowed } from "../sandboxMode.js";
import type { VmHandle } from "../firecracker/types.js";
import * as fcAgent from "../firecracker/agentRpc.js";
import { isSensitiveProjectPath } from "../security/sensitivePaths.js";

export const sandboxEvents = new EventEmitter();

/**
 * Sandbox handle. Two backends:
 *
 * - **process** (default): `rootDir` is a host-fs path; ops happen in the
 *   orchestrator's process tree (`spawn`, `fs.*`).
 * - **firecracker**: `vm` is set, and every op is RPC'd to the in-VM
 *   sandbox-agent over vsock. `rootDir` is still set so callers that need
 *   a host-side path for storage sync / uploads / ZIP import keep working
 *   (the orchestrator stages files at `rootDir` and the fleet manager
 *   syncs them into the VM at boot + on demand).
 */
export interface Sandbox {
  rootDir: string;
  vm?: VmHandle;
}

const HALF_MAX = 8 * 1024;
const MAX_LOG = 64 * 1024;

interface ShellChoice {
  shell: string;
  prefix: string[];
  name: string;
  isUnixLike: boolean;
}

let cachedShell: ShellChoice | null = null;

function pickShell(): ShellChoice {
  if (cachedShell) return cachedShell;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        cachedShell = {
          shell: c,
          prefix: ["-c"],
          name: "git-bash",
          isUnixLike: true,
        };
        return cachedShell;
      }
    }
    cachedShell = {
      shell: "cmd.exe",
      prefix: ["/c"],
      name: "cmd.exe",
      isUnixLike: false,
    };
    return cachedShell;
  }
  cachedShell = {
    shell: "/bin/sh",
    prefix: ["-c"],
    name: "sh",
    isUnixLike: true,
  };
  return cachedShell;
}

export function shellInfo(): { name: string; isUnixLike: boolean } {
  const c = pickShell();
  return { name: c.name, isUnixLike: c.isUnixLike };
}

function resolvePath(sandbox: Sandbox, p: string): string {
  const lexicalRoot = path.resolve(sandbox.rootDir);
  const lexical = path.resolve(lexicalRoot, p);
  const lexicalRelative = path.relative(lexicalRoot, lexical);
  if (lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error(`Path escapes sandbox: ${p}`);
  }
  const root = existsSync(lexicalRoot) ? realpathSync(lexicalRoot) : lexicalRoot;
  let ancestor = lexical;
  const missing: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Path escapes sandbox: ${p}`);
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = realpathSync(ancestor);
  const canonicalRelative = path.relative(root, canonicalAncestor);
  if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
    throw new Error(`Path escapes sandbox through a symlink: ${p}`);
  }
  return path.join(canonicalAncestor, ...missing);
}

async function writeResolvedFile(full: string, content: string | Buffer): Promise<void> {
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_TRUNC |
    (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(full, flags, 0o666);
  try {
    await handle.writeFile(typeof content === "string" ? Buffer.from(content, "utf-8") : content);
  } finally {
    await handle.close();
  }
}

/** Preserve the existing cap for internal consumers such as predeploy scans. */
const MAX_INTERNAL_READ_BYTES = 256 * 1024;
/** Model-facing reads sit below the loop's 32 KiB replay ceiling. */
const MODEL_READ_BYTES = 30 * 1024;
const READ_GAP_RESERVE_BYTES = 256;
const GREP_HEAD_BYTES = 20 * 1024;
const GREP_TAIL_BYTES = 8 * 1024;
const MAX_GREP_LINE_BYTES = 7 * 1024;

/** Default line window when a range read is requested without an explicit limit. */
const DEFAULT_READ_LINE_LIMIT = 2000;

const SANDBOX_TEXT_META = Symbol("sandboxTextMeta");

/** Private execution metadata. The symbol key is never serialized to the model. */
export interface SandboxTextResult {
  text: string;
  [SANDBOX_TEXT_META]: { truncated: boolean };
}

function sandboxTextResult(text: string, truncated: boolean): SandboxTextResult {
  return { text, [SANDBOX_TEXT_META]: { truncated } };
}

export function isSandboxTextResult(value: unknown): value is SandboxTextResult {
  return typeof value === "object" && value !== null && SANDBOX_TEXT_META in value;
}

export function sandboxTextWasTruncated(result: SandboxTextResult): boolean {
  return result[SANDBOX_TEXT_META].truncated;
}

class WeightedSemaphore {
  private active = 0;
  private readonly queue: Array<{
    weight: number;
    resolve: (release: () => void) => void;
  }> = [];

  constructor(private readonly capacity: number) {}

  acquire(requestedWeight: number): Promise<() => void> {
    const weight = Math.max(1, Math.min(this.capacity, Math.floor(requestedWeight)));
    return new Promise((resolve) => {
      this.queue.push({ weight, resolve });
      this.drain();
    });
  }

  isIdle(): boolean {
    return this.active === 0 && this.queue.length === 0;
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (this.active + next.weight > this.capacity) return;
      this.queue.shift();
      this.active += next.weight;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        this.active -= next.weight;
        this.drain();
      });
    }
  }
}

const SANDBOX_IO_CAPACITY = 8;
const sandboxIoSemaphores = new Map<string, WeightedSemaphore>();

function sandboxIoKey(sandbox: Sandbox): string {
  return sandbox.vm ? `vm:${sandbox.vm.id}` : `fs:${path.resolve(sandbox.rootDir)}`;
}

async function withSandboxIoPermit<T>(
  sandbox: Sandbox,
  weight: number,
  operation: () => Promise<T>,
): Promise<T> {
  const key = sandboxIoKey(sandbox);
  let semaphore = sandboxIoSemaphores.get(key);
  if (!semaphore) {
    semaphore = new WeightedSemaphore(SANDBOX_IO_CAPACITY);
    sandboxIoSemaphores.set(key, semaphore);
  }
  const release = await semaphore.acquire(weight);
  try {
    return await operation();
  } finally {
    release();
    if (semaphore.isIdle() && sandboxIoSemaphores.get(key) === semaphore) {
      sandboxIoSemaphores.delete(key);
    }
  }
}

export interface ReadFileOptions {
  /** 1-based line to start reading from. */
  offset?: number;
  /** Maximum number of lines to return starting at offset. */
  limit?: number;
}

/**
 * Slice `content` to the requested 1-based [offset, offset+limit) line window and
 * prefix a `[lines X–Y of N]` header so the model knows where it is. Shared by the
 * host path and the VM path (which slices in-guest and reports total_lines).
 */
export function sliceLines(
  content: string,
  total: number,
  offset?: number,
  limit?: number,
): string {
  const start = Math.max(1, offset ?? 1);
  const count = Math.max(1, limit ?? DEFAULT_READ_LINE_LIMIT);
  if (start > total) {
    return `[file has ${total} line(s); offset ${start} is past the end]`;
  }
  const end = Math.min(total, start + count - 1);
  return `[lines ${start}–${end} of ${total}]\n${content}`;
}

function utf8Head(text: string, maxBytes: number): string {
  const buf = Buffer.from(text);
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8");
}

interface BoundedFullRead {
  content: string;
  returnedBytes: number;
  headBytes: number;
  tailBytes: number;
  omittedBytes: number;
}

async function readTextWindow(
  full: string,
  totalBytes: number,
  cap: number,
  headTail: boolean,
): Promise<BoundedFullRead> {
  const useHeadTail = headTail && cap >= READ_GAP_RESERVE_BYTES * 2;
  const dataBudget = useHeadTail ? cap - READ_GAP_RESERVE_BYTES : cap;
  const headBudget = useHeadTail ? Math.floor((dataBudget * 2) / 3) : dataBudget;
  const tailBudget = useHeadTail ? dataBudget - headBudget : 0;
  const handle = await fs.open(full, "r");
  try {
    const headBuffer = Buffer.alloc(Math.min(totalBytes, headBudget + 3));
    const { bytesRead: headRead } = await handle.read(
      headBuffer,
      0,
      headBuffer.length,
      0,
    );
    let headEnd = Math.min(headRead, headBudget);
    while (headEnd > 0 && headEnd < headRead && (headBuffer[headEnd] & 0xc0) === 0x80) {
      headEnd--;
    }
    const head = headBuffer.subarray(0, headEnd).toString("utf-8");
    const headBytes = Buffer.byteLength(head);

    if (!useHeadTail) {
      return {
        content: head,
        returnedBytes: headBytes,
        headBytes,
        tailBytes: 0,
        omittedBytes: Math.max(0, totalBytes - headEnd),
      };
    }

    const tailBuffer = Buffer.alloc(tailBudget);
    const tailOffset = Math.max(0, totalBytes - tailBudget);
    const { bytesRead: tailRead } = await handle.read(
      tailBuffer,
      0,
      tailBuffer.length,
      tailOffset,
    );
    let tailStart = 0;
    while (tailStart < tailRead && (tailBuffer[tailStart] & 0xc0) === 0x80) tailStart++;
    const tail = tailBuffer.subarray(tailStart, tailRead).toString("utf-8");
    const tailBytes = Buffer.byteLength(tail);
    const omittedBytes = Math.max(0, totalBytes - headEnd - (tailRead - tailStart));
    const marker = `\n\n[... ${omittedBytes} bytes omitted from the middle ...]\n\n`;
    const content = `${head}${marker}${tail}`;
    return {
      content,
      returnedBytes: Buffer.byteLength(content),
      headBytes,
      tailBytes,
      omittedBytes,
    };
  } finally {
    await handle.close();
  }
}

interface BoundedRange {
  content: string;
  /** Exact only when the scan reached EOF. */
  totalLines: number | null;
  /** Lower bound that remains useful when the scan stopped early. */
  knownLines: number;
  hasMore: boolean;
  selectedBytes: number;
  returnedBytes: number;
  returnedEndLine: number | null;
  requestedEndLine: number | null;
  truncated: boolean;
}

async function readBoundedLineRange(
  full: string,
  start: number,
  count: number,
  cap: number,
): Promise<BoundedRange> {
  const desiredEndLine = Math.min(
    Number.MAX_SAFE_INTEGER,
    start + Math.max(0, count - 1),
  );
  const storeLimit = cap + 3;
  const stored = Buffer.alloc(storeLimit);
  let selectedBytes = 0;
  let storedBytes = 0;
  let lineNo = 1;
  let stoppedEarly = false;

  const appendSelected = (chunk: Buffer, from: number, to: number): void => {
    if (to <= from) return;
    const length = to - from;
    selectedBytes += length;
    if (storedBytes >= storeLimit) return;
    const keep = Math.min(length, storeLimit - storedBytes);
    chunk.copy(stored, storedBytes, from, from + keep);
    storedBytes += keep;
  };

  scan: for await (const value of createReadStream(full)) {
    const chunk = value as Buffer;
    let pos = 0;
    while (pos < chunk.length) {
      const newline = chunk.indexOf(0x0a, pos);
      const end = newline === -1 ? chunk.length : newline;
      if (lineNo >= start && lineNo <= desiredEndLine) {
        appendSelected(chunk, pos, end);
        if (storedBytes >= storeLimit) {
          stoppedEarly = true;
          break scan;
        }
      }
      if (newline === -1) break;
      if (lineNo >= start && lineNo < desiredEndLine) {
        appendSelected(chunk, newline, newline + 1);
        if (storedBytes >= storeLimit) {
          stoppedEarly = true;
          break scan;
        }
      }
      const completedLine = lineNo;
      lineNo++;
      pos = newline + 1;
      if (completedLine >= desiredEndLine) {
        // A newline proves that at least one further (possibly empty) line
        // exists. Do not scan the rest of a multi-gigabyte file just to turn
        // that lower bound into an exact total.
        stoppedEarly = true;
        break scan;
      }
    }
  }

  const totalLines = stoppedEarly ? null : lineNo;
  const knownLines = lineNo;
  const requestedEndLine =
    totalLines === null
      ? desiredEndLine
      : start > totalLines
        ? null
        : Math.min(totalLines, desiredEndLine);
  let sourceEnd = Math.min(cap, storedBytes);
  while (
    sourceEnd > 0 &&
    sourceEnd < storedBytes &&
    (stored[sourceEnd] & 0xc0) === 0x80
  ) {
    sourceEnd--;
  }
  const content = stored.subarray(0, sourceEnd).toString("utf-8");
  let returnedEndLine: number | null = null;
  if (requestedEndLine !== null) {
    let returnedNewlines = 0;
    for (let i = 0; i < sourceEnd; i++) {
      if (stored[i] === 0x0a) returnedNewlines++;
    }
    returnedEndLine = Math.min(requestedEndLine, start + returnedNewlines);
  }
  const returnedBytes = Buffer.byteLength(content);
  return {
    content,
    totalLines,
    knownLines,
    hasMore: stoppedEarly,
    selectedBytes,
    returnedBytes,
    returnedEndLine,
    requestedEndLine,
    truncated: selectedBytes > sourceEnd,
  };
}

async function readFileResultUnlocked(
  sandbox: Sandbox,
  p: string,
  opts?: ReadFileOptions,
): Promise<SandboxTextResult> {
  // The tool path always supplies an options object (even when both fields are
  // undefined); internal predeploy/diff callers omit it. This preserves their
  // established 256 KiB window while avoiding 8x over-transfer to a model turn
  // that will retain at most 32 KiB.
  const responseCap = opts ? MODEL_READ_BYTES : MAX_INTERNAL_READ_BYTES;
  if (sandbox.vm) {
    const result = await fcAgent.readFileResult(sandbox.vm, p, {
      ...opts,
      maxBytes: responseCap,
      headTail: opts !== undefined,
      allowSensitive: opts === undefined,
    });
    return sandboxTextResult(result.text, result.truncated);
  }
  const full = resolvePath(sandbox, p);
  if (opts !== undefined) {
    const resolved = await fs.realpath(full).catch(() => full);
    if (isSensitiveProjectPath(path.relative(path.resolve(sandbox.rootDir), resolved))) {
      throw new Error("access to secret-bearing project paths is blocked");
    }
  }

  // Range read: return just the requested line window (cheap for huge files).
  if (opts && (opts.offset !== undefined || opts.limit !== undefined)) {
    const start = Math.max(1, Math.floor(opts.offset ?? 1));
    const count = Math.max(
      1,
      Math.floor(opts.limit ?? DEFAULT_READ_LINE_LIMIT),
    );
    const range = await readBoundedLineRange(full, start, count, responseCap);
    if (range.totalLines !== null && start > range.totalLines) {
      return sandboxTextResult(
        `[file has ${range.totalLines} line(s); offset ${start} is past the end]`,
        false,
      );
    }
    const end = range.returnedEndLine ?? range.requestedEndLine ?? start;
    const note = range.truncated
      ? `\n\n[... selected range truncated in the sandbox: at least ${range.selectedBytes} bytes selected, showing the first ${range.returnedBytes} bytes through line ${end}. Reduce limit or request a narrower range. ...]`
      : "";
    const totalLabel =
      range.totalLines === null
        ? `at least ${range.knownLines}`
        : String(range.totalLines);
    return sandboxTextResult(
      `[lines ${start}–${end} of ${totalLabel}]\n${range.content}${note}`,
      range.truncated,
    );
  }

  const stat = await fs.stat(full);
  if (stat.size > responseCap) {
    const read = await readTextWindow(full, stat.size, responseCap, opts !== undefined);
    const detail =
      read.tailBytes > 0
        ? `showing the first ${read.headBytes} and last ${read.tailBytes} bytes (${read.omittedBytes} omitted)`
        : `showing the first ${read.headBytes} bytes`;
    return sandboxTextResult(
      read.content +
        `\n\n[... file truncated in the sandbox: ${stat.size} bytes total, ${detail}. Pass offset/limit to read a specific line range. ...]`,
      true,
    );
  }
  return sandboxTextResult(await fs.readFile(full, "utf-8"), false);
}

export async function readFileResult(
  sandbox: Sandbox,
  p: string,
  opts?: ReadFileOptions,
): Promise<SandboxTextResult> {
  return await withSandboxIoPermit(sandbox, 1, () =>
    readFileResultUnlocked(sandbox, p, opts),
  );
}

export async function readFile(
  sandbox: Sandbox,
  p: string,
  opts?: ReadFileOptions,
): Promise<string> {
  return (await readFileResult(sandbox, p, opts)).text;
}

export async function writeFile(
  sandbox: Sandbox,
  p: string,
  content: string,
): Promise<void> {
  if (sandbox.vm) {
    await fcAgent.writeFile(sandbox.vm, p, content);
    // Mirror host-side so the existing storage sync / file tree walker still
    // surfaces the change. The VM is the authoritative copy but the file tree
    // and storage sync read from the host filesystem.
    try {
      const full = resolvePath(sandbox, p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await writeResolvedFile(full, content);
    } catch (err) {
      console.error(`[sandbox] host mirror failed for ${p}:`, err);
    }
    return;
  }
  const full = resolvePath(sandbox, p);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await writeResolvedFile(full, content);
}

/**
 * Binary-safe sibling of writeFile (e.g. a generated image). In Firecracker mode
 * the file is pushed into the VM (the authoritative copy the dev server serves)
 * AND mirrored host-side so the file tree / storage sync still see it.
 */
export async function writeFileBinary(
  sandbox: Sandbox,
  p: string,
  content: Buffer,
): Promise<void> {
  if (sandbox.vm) {
    await fcAgent.pushFile(sandbox.vm, p, content);
    try {
      const full = resolvePath(sandbox, p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await writeResolvedFile(full, content);
    } catch (err) {
      console.error(`[sandbox] host mirror failed for ${p}:`, err);
    }
    return;
  }
  const full = resolvePath(sandbox, p);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await writeResolvedFile(full, content);
}

/** Internal full-file pull for host mirroring. Model-facing readFile is capped. */
async function readVmTextForMirror(
  vm: VmHandle,
  p: string,
): Promise<string | null> {
  // null is an explicit capability result from an old agent. Transport/HTTP
  // failures must propagate so the outer best-effort mirror block leaves the
  // existing host copy untouched instead of replacing it with capped text.
  const binary = await fcAgent.readFileBinary(vm, p);
  if (binary) return binary.toString("utf-8");
  // Compatibility with agents that predate binary reads. Those agents also
  // predate guest-side text caps, so this fallback still returns the full file.
  return await fcAgent.readFile(vm, p);
}

export async function editFile(
  sandbox: Sandbox,
  p: string,
  oldString: string,
  newString: string,
): Promise<void> {
  if (sandbox.vm) {
    await fcAgent.editFile(sandbox.vm, p, oldString, newString);
    // Best-effort host mirror — match writeFile. If the host copy is stale
    // (editFile couldn't find oldString), fall back to reading the full file
    // from the VM and writing it to the host so the tree stays accurate.
    try {
      const full = resolvePath(sandbox, p);
      const content = await fs.readFile(full, "utf-8").catch(() => null);
      if (content !== null) {
        const occurrences = content.split(oldString).length - 1;
        if (occurrences === 1) {
          await fs.writeFile(
            full,
            content.replace(oldString, newString),
            "utf-8",
          );
        } else {
          // Host copy is out of sync — re-fetch from VM.
          const vmContent = await readVmTextForMirror(sandbox.vm, p);
          if (vmContent !== null) {
            await fs.mkdir(path.dirname(full), { recursive: true });
            await writeResolvedFile(full, vmContent);
          }
        }
      } else {
        // File doesn't exist on host yet — pull from VM.
        const vmContent = await readVmTextForMirror(sandbox.vm, p);
        if (vmContent !== null) {
          await fs.mkdir(path.dirname(full), { recursive: true });
          await writeResolvedFile(full, vmContent);
        }
      }
    } catch (err) {
      console.error(`[sandbox] host mirror (edit) failed for ${p}:`, err);
    }
    return;
  }
  const full = resolvePath(sandbox, p);
  const content = await fs.readFile(full, "utf-8");
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) throw new Error(`old_string not found in ${p}`);
  if (occurrences > 1)
    throw new Error(
      `old_string is not unique in ${p} (${occurrences} matches)`,
    );
  await writeResolvedFile(full, content.replace(oldString, newString));
}

export async function listDir(sandbox: Sandbox, p?: string): Promise<string[]> {
  return await withSandboxIoPermit(sandbox, 1, async () => {
    if (sandbox.vm) return await fcAgent.listDir(sandbox.vm, p);
    const target = p ? resolvePath(sandbox, p) : path.resolve(sandbox.rootDir);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  });
}

export interface GrepOptions {
  caseInsensitive?: boolean;
  /** Treat pattern as a plain substring, not a regex. */
  literal?: boolean;
}

interface BoundedMatches {
  head: string[];
  tail: string[];
  headBytes: number;
  tailBytes: number;
  collectingHead: boolean;
  totalMatches: number;
  lineTruncations: number;
}

function createBoundedMatches(): BoundedMatches {
  return {
    head: [],
    tail: [],
    headBytes: 0,
    tailBytes: 0,
    collectingHead: true,
    totalMatches: 0,
    lineTruncations: 0,
  };
}

function pushBoundedMatch(bounded: BoundedMatches, rawLine: string): void {
  bounded.totalMatches++;
  const marker = " ... [matching line truncated]";
  const shortened = Buffer.byteLength(rawLine) > MAX_GREP_LINE_BYTES;
  const line = shortened
    ? `${utf8Head(rawLine, MAX_GREP_LINE_BYTES - Buffer.byteLength(marker))}${marker}`
    : rawLine;
  if (shortened) bounded.lineTruncations++;
  const storedBytes = Buffer.byteLength(line) + 1;
  if (
    bounded.collectingHead &&
    bounded.headBytes + storedBytes <= GREP_HEAD_BYTES
  ) {
    bounded.head.push(line);
    bounded.headBytes += storedBytes;
    return;
  }

  bounded.collectingHead = false;
  while (
    bounded.tail.length &&
    bounded.tailBytes + storedBytes > GREP_TAIL_BYTES
  ) {
    const dropped = bounded.tail.shift()!;
    bounded.tailBytes -= Buffer.byteLength(dropped) + 1;
  }
  if (storedBytes <= GREP_TAIL_BYTES) {
    bounded.tail.push(line);
    bounded.tailBytes += storedBytes;
  }
}

function finishBoundedMatches(bounded: BoundedMatches): string {
  if (bounded.totalMatches === 0) return "(no matches)";
  const omitted = Math.max(
    0,
    bounded.totalMatches - bounded.head.length - bounded.tail.length,
  );
  const chunks: string[] = [];
  if (bounded.head.length) chunks.push(bounded.head.join("\n"));
  if (omitted > 0) {
    chunks.push(
      `[... ${omitted} middle matches omitted from the bounded search response ...]`,
    );
  }
  if (bounded.tail.length) chunks.push(bounded.tail.join("\n"));
  let result = chunks.join("\n");
  if (omitted > 0) {
    result += `\n\n[search truncated: showing first ${bounded.head.length} and last ${bounded.tail.length} of ${bounded.totalMatches} matches (${omitted} omitted). Narrow the pattern or path.]`;
  }
  if (bounded.lineTruncations > 0) {
    result += `\n\n[${bounded.lineTruncations} matching line(s) shortened to ${MAX_GREP_LINE_BYTES} bytes each.]`;
  }
  return result;
}

async function grepResultUnlocked(
  sandbox: Sandbox,
  pattern: string,
  p?: string,
  opts?: GrepOptions,
): Promise<SandboxTextResult> {
  if (sandbox.vm) {
    const result = await fcAgent.grepResult(sandbox.vm, pattern, p, opts);
    return sandboxTextResult(result.text, result.truncated);
  }
  const target = p ? resolvePath(sandbox, p) : path.resolve(sandbox.rootDir);

  // Build a matcher. A literal request — or a pattern that won't compile as a
  // regex (e.g. it contains literal parens/brackets the model meant verbatim) —
  // falls back to a case-aware substring test rather than erroring, so grep
  // behaves like the model expects from shell grep.
  const ci = opts?.caseInsensitive === true;
  let fellBackToLiteral = false;
  let regex: RegExp | null = null;
  if (!opts?.literal) {
    try {
      regex = new RegExp(pattern, ci ? "i" : "");
    } catch {
      fellBackToLiteral = true;
    }
  }
  const needle = ci ? pattern.toLowerCase() : pattern;
  const test = regex
    ? (line: string) => regex!.test(line)
    : (line: string) => (ci ? line.toLowerCase() : line).includes(needle);

  const bounded = createBoundedMatches();
  const root = await fs.realpath(path.resolve(sandbox.rootDir)).catch(() => path.resolve(sandbox.rootDir));
  // Stream each file and retain a bounded head+tail window. Continuing the scan
  // gives the model useful late matches without retaining the omitted middle.

  async function scanFile(full: string): Promise<void> {
    try {
      const resolved = await fs.realpath(full);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
      const rel = path.relative(root, resolved);
      if (isSensitiveProjectPath(rel)) return;
      const lines = createInterface({
        input: createReadStream(resolved),
        crlfDelay: Infinity,
      });
      let lineNo = 0;
      for await (const line of lines) {
        lineNo++;
        if (test(line)) {
          pushBoundedMatch(
            bounded,
            `${rel}:${lineNo}: ${line.trim()}`,
          );
        }
      }
    } catch {
      // skip binary or unreadable files
    }
  }

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        await scanFile(full);
      }
    }
  }

  const targetStat = await fs.stat(target);
  if (targetStat.isFile()) await scanFile(target);
  else if (targetStat.isDirectory()) await walk(target);
  const note = fellBackToLiteral
    ? "[pattern is not a valid regex — searched as a literal substring]\n"
    : "";
  const truncated =
    bounded.totalMatches > bounded.head.length + bounded.tail.length ||
    bounded.lineTruncations > 0;
  return sandboxTextResult(`${note}${finishBoundedMatches(bounded)}`, truncated);
}

export async function grepResult(
  sandbox: Sandbox,
  pattern: string,
  p?: string,
  opts?: GrepOptions,
): Promise<SandboxTextResult> {
  return await withSandboxIoPermit(sandbox, 2, () =>
    grepResultUnlocked(sandbox, pattern, p, opts),
  );
}

export async function grep(
  sandbox: Sandbox,
  pattern: string,
  p?: string,
  opts?: GrepOptions,
): Promise<string> {
  return (await grepResult(sandbox, pattern, p, opts)).text;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True when either stream was shortened before it reached the model. */
  truncated: boolean;
}

const COMMAND_TRUNCATION_MARKER = /\[\.\.\. truncated \d+ bytes \.\.\.\]/;

/** Preserve command truncation as private metadata while keeping wire text stable. */
export function commandResultText(result: CommandResult): SandboxTextResult {
  return sandboxTextResult(
    `exit_code: ${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    result.truncated,
  );
}

export async function runCommand(
  sandbox: Sandbox,
  command: string,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<CommandResult> {
  if (sandbox.vm) {
    const result = await fcAgent.runCommand(sandbox.vm, command, timeoutMs, signal);
    return {
      ...result,
      // The current VM wire shape predates explicit metadata but both Rust and
      // Node agents insert this stable marker whenever either stream is capped.
      truncated:
        COMMAND_TRUNCATION_MARKER.test(result.stdout) ||
        COMMAND_TRUNCATION_MARKER.test(result.stderr),
    };
  }
  assertHostSandboxAllowed();
  return new Promise((resolve) => {
    const choice = pickShell();
    const child = spawn(choice.shell, [...choice.prefix, command], {
      cwd: sandbox.rootDir,
      env: safeChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout = new BoundedCommandOutput();
    const stderr = new BoundedCommandOutput();
    let killed = false;
    let abortedByUser = false;

    const timer = setTimeout(() => {
      killed = true;
      if (child.pid) treeKill(child.pid, "SIGKILL");
    }, timeoutMs);

    const onAbort = (): void => {
      abortedByUser = true;
      killed = true;
      if (child.pid) treeKill(child.pid, "SIGKILL");
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout.on("data", (d) => {
      stdout.append(d);
    });
    child.stderr.on("data", (d) => {
      stderr.append(d);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (abortedByUser) stderr.append("\n[killed: aborted by user]");
      else if (killed) stderr.append(`\n[killed: timeout after ${timeoutMs}ms]`);
      const boundedStdout = stdout.result();
      const boundedStderr = stderr.result();
      resolve({
        stdout: boundedStdout.text,
        stderr: boundedStderr.text,
        exitCode: code,
        truncated: boundedStdout.truncated || boundedStderr.truncated,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({
        stdout: "",
        stderr: `[spawn error] ${err.message}`,
        exitCode: 1,
        truncated: false,
      });
    });
  });
}

class BoundedCommandOutput {
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private totalBytes = 0;

  append(value: Buffer | string): void {
    let chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.totalBytes += chunk.length;
    if (this.head.length < HALF_MAX) {
      const take = Math.min(HALF_MAX - this.head.length, chunk.length);
      this.head = Buffer.concat([this.head, chunk.subarray(0, take)]);
      chunk = chunk.subarray(take);
    }
    if (chunk.length > 0) {
      this.tail = Buffer.concat([this.tail, chunk]);
      if (this.tail.length > HALF_MAX) this.tail = this.tail.subarray(this.tail.length - HALF_MAX);
    }
  }

  result(): { text: string; truncated: boolean } {
    if (this.totalBytes <= HALF_MAX * 2) {
      return { text: Buffer.concat([this.head, this.tail]).toString("utf-8"), truncated: false };
    }
    return {
      text:
        `${this.head.toString("utf-8")}\n\n` +
        `[... truncated ${this.totalBytes - HALF_MAX * 2} bytes ...]\n\n` +
        this.tail.toString("utf-8"),
      truncated: true,
    };
  }
}

export async function waitForPort(
  port: number,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.end();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (ok) return true;
    // Abort-aware sleep so Stop responds within ~250ms instead of waiting
    // out the full timeout.
    const aborted = await new Promise<boolean>((resolve) => {
      let settled = false;
      let t: ReturnType<typeof setTimeout> | undefined;
      const finish = (abortedNow: boolean): void => {
        if (settled) return;
        settled = true;
        if (t) clearTimeout(t);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(abortedNow);
      };
      const onAbort = (): void => finish(true);
      t = setTimeout(() => finish(false), 250);
      if (signal) {
        if (signal.aborted) finish(true);
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    if (aborted) return false;
  }
  return false;
}

/**
 * One-shot check: is anyone accepting connections on this port? Single TCP
 * probe with a ~30ms ceiling — used to decide whether we need to clear the
 * port before binding.
 */
async function isPortOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    const done = (open: boolean): void => {
      try {
        sock.end();
      } catch {}
      resolve(open);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 100);
  });
}

/**
 * Wait until a port is NOT listening (i.e. no one accepts connections on it).
 * Used after we kill a previous dev server to make sure the OS has released
 * the socket before we spawn the next one — without this we hit EADDRINUSE.
 */
export async function waitForPortClosed(
  port: number,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.end();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (!open) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Best-effort kill of any process currently holding `port`. Used before
 * spawning a new server so we don't trip on EADDRINUSE from a zombie process
 * (e.g. a `npm run dev` the agent ran via run_command earlier — that holds
 * the port until run_command's 60s timeout). Tries `fuser` first because it's
 * the most common on Linux containers; falls back to `lsof` then a /proc walk.
 *
 * Resolves regardless of success — the caller should poll the port afterwards
 * to verify it's actually free.
 */
export async function killPortHolder(port: number): Promise<void> {
  if (process.platform === "win32") return; // Windows: skip; users dev locally
  // 1. fuser -k -n tcp <port>
  await new Promise<void>((resolve) => {
    const p = spawn("fuser", ["-k", "-n", "tcp", String(port)], {
      env: safeChildEnv(),
      stdio: "ignore",
    });
    p.once("error", () => resolve());
    p.once("close", () => resolve());
  });
  // 2. lsof -ti:<port> | xargs -r kill -9
  await new Promise<void>((resolve) => {
    const p = spawn("/bin/sh", ["-c", `lsof -ti:${port} | xargs -r kill -9`], {
      env: safeChildEnv(),
      stdio: "ignore",
    });
    p.once("error", () => resolve());
    p.once("close", () => resolve());
  });
}

// ── server management ────────────────────────────────────────────────────────

export interface ServerInfo {
  id: string;
  command: string;
  port: number;
  pid: number;
  started_at: number;
}

interface ManagedServer extends ServerInfo {
  proc: ChildProcess;
  log: { value: string };
  project_id: string | null;
  /** Set when the server runs inside a Firecracker VM. */
  vm?: VmHandle;
  /**
   * For VM-backed servers: the id the in-VM agent knows this server by. The
   * host map is keyed by an unguessable 128-bit `id` (the preview capability,
   * M-6), so VM RPCs must address the agent by THIS id instead.
   */
  vmServerId?: string;
}

const servers = new Map<string, ManagedServer>();

export async function startServer(
  sandbox: Sandbox,
  command: string,
  port: number,
  readyTimeoutMs = 60_000,
  projectId: string | null = null,
  signal?: AbortSignal,
): Promise<ServerInfo> {
  // Honor an already-aborted signal up front so a queued Stop doesn't get
  // swallowed by a fresh spawn.
  if (signal?.aborted) {
    throw new Error("start_server aborted before spawn");
  }
  if (sandbox.vm) {
    // In Firecracker mode the dev server runs inside the VM. The in-VM
    // agent supervises it; we get back a server id + the in-VM port. The
    // preview proxy must learn how to reach the VM (per-VM TAP IP) — see
    // proxy.ts; until that's wired the preview won't render but the
    // server starts cleanly.
    const r = await fcAgent.startServer(
      sandbox.vm,
      command,
      port,
      readyTimeoutMs,
      signal,
    );
    // Expose an unguessable 128-bit host id (the preview capability — M-6),
    // independent of the in-VM agent's shorter id, which we keep as vmServerId
    // for addressing the agent on stop/log RPCs.
    const id = `srv_${randomUUID().replace(/-/g, "")}`;
    // Track in the host-side servers map so list_servers / stop_server work.
    const server: ManagedServer = {
      id,
      command,
      port: r.port,
      pid: r.pid,
      started_at: Date.now(),
      proc: { kill: () => {} } as unknown as ChildProcess,
      log: { value: "" },
      project_id: projectId,
      vm: sandbox.vm,
      vmServerId: r.id,
    };
    servers.set(id, server);
    return {
      id,
      command,
      port: r.port,
      pid: r.pid,
      started_at: server.started_at,
    };
  }
  assertHostSandboxAllowed();
  // Pre-clear the port. Fast path: if it's already free, this is two
  // ~10ms TCP probes. Slow path: a zombie (often `npm run dev` ran via
  // run_command which holds the port for the full timeout) gets killed
  // and we wait briefly for the kernel to release the socket.
  const portOpenBefore = await isPortOpen(port);
  if (portOpenBefore) {
    await killPortHolder(port);
    const closed = await waitForPortClosed(port, 5_000);
    if (!closed) {
      throw new Error(
        `Port ${port} is held by a process we couldn't kill (tried fuser + lsof). Try a different port, or restart the orchestrator.`,
      );
    }
  }

  // Full 128-bit token, not a 32-bit slice. The preview proxy authorizes purely
  // by this id (it can't see the cross-origin app session), so the id IS the
  // capability — a guessable 32-bit value made the preview an online-enumerable
  // IDOR into other tenants' dev servers (M-6 / H-1). Keep the `srv_` prefix the
  // proxy's PREVIEW_PREFIX regex matches.
  const id = `srv_${randomUUID().replace(/-/g, "")}`;
  const choice = pickShell();
  const proc = spawn(choice.shell, [...choice.prefix, command], {
    cwd: sandbox.rootDir,
    env: safeChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Attach an `error` listener IMMEDIATELY. Without it, Node treats a spawn
  // failure (binary missing, EAGAIN, ENOMEM, etc.) as an uncaught exception
  // and kills the orchestrator process — which was crashing Railway every
  // time the Run button or agent tried to start something the host couldn't
  // launch. We capture the error and surface it through the awaited promise
  // below instead.
  // Use a holder object so TS doesn't narrow the variable to `null` after
  // initialization — the listener mutates it asynchronously.
  const errorBox: { err: Error | null } = { err: null };
  proc.once("error", (err) => {
    errorBox.err = err;
  });

  if (!proc.pid) {
    // Give Node a tick to emit the deferred 'error' event so we have its
    // message rather than a generic "Failed to spawn".
    await new Promise((r) => setImmediate(r));
    throw new Error(
      `Failed to spawn server process${errorBox.err ? `: ${errorBox.err.message}` : ""}`,
    );
  }

  const log = { value: "" };
  const append = (chunk: Buffer): void => {
    log.value = (log.value + chunk.toString()).slice(-MAX_LOG);
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);

  const server: ManagedServer = {
    id,
    command,
    port,
    pid: proc.pid,
    started_at: Date.now(),
    proc,
    log,
    project_id: projectId,
  };
  servers.set(id, server);

  proc.on("exit", () => {
    if (servers.delete(id)) {
      sandboxEvents.emit("server_exit", id, projectId);
    }
  });

  const ok = await waitForPort(port, readyTimeoutMs, signal);
  if (errorBox.err) {
    servers.delete(id);
    throw new Error(`Server spawn failed: ${errorBox.err.message}`);
  }
  if (signal?.aborted) {
    // User clicked Stop while we were waiting for the port. Kill the spawn
    // and surface a clean abort error so the agent loop drops the turn.
    treeKill(proc.pid, "SIGKILL");
    servers.delete(id);
    throw new Error("start_server aborted by user");
  }
  if (!ok) {
    treeKill(proc.pid, "SIGKILL");
    servers.delete(id);
    throw new Error(
      `Server did not open port ${port} within ${readyTimeoutMs}ms.\nRecent log:\n${log.value.slice(-2000)}`,
    );
  }

  return { id, command, port, pid: server.pid, started_at: server.started_at };
}

function ownedServer(expectedProjectId: string, id: string): ManagedServer | null {
  const server = servers.get(id);
  return server?.project_id === expectedProjectId ? server : null;
}

export async function stopServer(expectedProjectId: string, id: string): Promise<void> {
  const server = ownedServer(expectedProjectId, id);
  if (!server) throw new Error(`No server with id ${id}`);
  if (server.vm) {
    // Address the agent by the id IT knows (vmServerId), not the host id.
    await fcAgent.stopServer(server.vm, server.vmServerId ?? id);
  } else {
    treeKill(server.pid, "SIGKILL");
  }
  // Keep the handle retryable when guest termination fails.
  servers.delete(id);
}

/**
 * Drop every VM-backed server belonging to a project. Called by the fleet
 * manager when a project's VM is destroyed/reclaimed — at that point the
 * firecracker process is killed and the in-VM server processes are gone for
 * good, but (unlike process-backed servers, which self-prune via proc.on(
 * 'exit')) nothing else removes their entries. Without this they linger in the
 * map → wrong list_servers, leaked ids, and the preview proxy dialing a dead
 * VM IP. Emits 'server_exit' so the UI clears the stopped server too.
 */
export function removeServersForProject(projectId: string): void {
  for (const [id, s] of servers) {
    if (s.vm && s.project_id === projectId) {
      servers.delete(id);
      sandboxEvents.emit("server_exit", id, s.project_id);
    }
  }
}

export function listServers(projectId?: string | null): ServerInfo[] {
  const all = Array.from(servers.values());
  const filtered =
    projectId === undefined
      ? all
      : all.filter((s) => s.project_id === projectId);
  return filtered.map((s) => ({
    id: s.id,
    command: s.command,
    port: s.port,
    pid: s.pid,
    started_at: s.started_at,
  }));
}

export function getServer(expectedProjectId: string, id: string): {
  id: string;
  command: string;
  port: number;
  project_id: string | null;
  /** Host to dial when proxying to this server. "127.0.0.1" for process-backed; the VM's IP for VM-backed. */
  host: string;
} | null {
  const s = ownedServer(expectedProjectId, id);
  if (!s) return null;
  const host = s.vm?.ip ?? "127.0.0.1";
  return {
    id: s.id,
    command: s.command,
    port: s.port,
    project_id: s.project_id,
    host,
  };
}

/** View-capability lookup used only by the isolated preview proxy/share path. */
export function getServerByCapability(id: string): ReturnType<typeof getServer> {
  const server = servers.get(id);
  if (!server?.project_id) return null;
  return getServer(server.project_id, id);
}

export function readServerLog(expectedProjectId: string, id: string, maxBytes = 8000): string {
  const server = ownedServer(expectedProjectId, id);
  if (!server) throw new Error(`No server with id ${id}`);
  // For VM-backed servers we don't tail synchronously today — the in-VM
  // agent buffers log lines and exposes them via a separate RPC; callers
  // that want a live tail use readServerLogAsync below.
  return server.log.value.slice(-maxBytes);
}

/**
 * Async variant that fetches the log from the in-VM agent for VM-backed
 * servers. Process-backed servers fall through to the in-memory buffer.
 */
export async function readServerLogAsync(
  expectedProjectId: string,
  id: string,
  maxBytes = 8000,
): Promise<string> {
  const server = ownedServer(expectedProjectId, id);
  if (!server) throw new Error(`No server with id ${id}`);
  if (server.vm) {
    try {
      return await fcAgent.readServerLog(
        server.vm,
        server.vmServerId ?? id,
        maxBytes,
      );
    } catch (err) {
      // The in-VM agent prunes a server the instant its process exits, but never
      // tells the host — so our entry lingers and the agent's id resolves to a
      // vmServerId the VM no longer has. That surfaced as a cryptic
      // "HTTP 404: no server <internal-id>" the model couldn't act on, sending it
      // into a stop→edit→restart spiral. Detect the gone-server case, prune the
      // stale host entry (so list_servers/the preview stop pointing at a corpse),
      // and hand back an honest, actionable message instead of the raw 404.
      if (isServerGoneError(err)) {
        servers.delete(id);
        sandboxEvents.emit("server_exit", id, server.project_id);
        return `The dev server ${id} is no longer running — its process exited inside the sandbox (it most likely crashed on startup or after a code change). Its in-VM log was discarded when it died. Start it again with start_server and watch the new log; if it keeps dying, the crash is in the app, not the server — check the most recent edit.`;
      }
      throw err;
    }
  }
  return server.log.value.slice(-maxBytes);
}

/**
 * True when an in-VM RPC failed because the server no longer exists in the
 * guest (its process exited and the in-VM reaper removed it). The agent replies
 * `404 {"error":"no server <id>"}`, which our rpc() wraps into the Error message.
 */
function isServerGoneError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP 404/.test(msg) && /no server/.test(msg);
}

export function stopAllServers(): void {
  for (const s of servers.values()) {
    // C-90: for VM-backed servers s.pid is the IN-GUEST pid (a low number on
    // the host's pid namespace). treeKilling it as root would target an
    // unrelated host process. The VM teardown (fleet shutdownAll → ctrlAltDel)
    // reaps in-guest processes; only kill host process-backed servers here.
    if (s.vm) continue;
    try {
      treeKill(s.pid, "SIGKILL");
    } catch {}
  }
  servers.clear();
}

// Clean up process-backed dev servers on exit. NOTE (C-36): we deliberately do
// NOT call process.exit() from the signal handlers — doing so preempted the
// fleet's graceful shutdown (shutdownAllVms → ctrlAltDel, tap teardown) that
// server.ts registers later, orphaning firecracker children across every
// deploy/restart. We only release our own resources and let server.ts's signal
// handlers (or the default behavior) drive the actual exit.
process.on("exit", stopAllServers);
process.on("SIGINT", stopAllServers);
process.on("SIGTERM", stopAllServers);
