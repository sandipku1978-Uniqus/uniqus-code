import { createHash } from "node:crypto";

/** Maximum simultaneous VM/DB reads from one model tool batch. */
export const MAX_PARALLEL_READ_TOOLS = 4;

/**
 * Deliberately explicit. Adding a tool here requires proving it has no mutation,
 * approval, browser, command, connector-write, or hidden ordering semantics.
 */
export const PARALLEL_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "list_dir",
  "grep",
  "list_servers",
  "list_flows",
  "list_connectors",
  "list_secrets",
  "list_assets",
  "knowledge_search",
  "read_background_log",
  "list_background",
]);

const VERIFICATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "predeploy_check",
  "interact_preview",
  "run_flow",
  "screenshot_preview",
]);

export type VerificationCheckKind = "build" | "test" | "browser";

export interface VerificationToolCheck {
  kind: VerificationCheckKind;
  /** Bounded, one-way identity used only inside the current run. */
  fingerprint: string;
  /** A screenshot is evidence, not a passing assertion. */
  passive: boolean;
}

const TEST_COMMAND = /\b(test|vitest|jest|pytest)\b|\bcargo\s+test\b/i;
const BUILD_COMMAND = /\b(build|typecheck|tsc|lint|check)\b/i;
const MAX_FINGERPRINT_INPUT_CHARS = 16 * 1024;

function stableFingerprintValue(value: unknown, depth = 0): string {
  if (depth > 5) return "<depth>";
  if (value === null) return "null";
  if (typeof value === "string") {
    const bounded = value.slice(0, MAX_FINGERPRINT_INPUT_CHARS);
    return JSON.stringify(`${bounded}<length:${value.length}>`);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.slice(0, 128).map((item) => stableFingerprintValue(item, depth + 1)).join(",")}]<length:${value.length}>`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort().slice(0, 128);
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableFingerprintValue(record[key], depth + 1)}`)
      .join(",")}}<keys:${Object.keys(record).length}>`;
  }
  return `<${typeof value}>`;
}

/** Privacy-safe semantic identity; no tool input is retained or persisted. */
export function toolCallFingerprint(name: string, input: unknown): string {
  const hash = createHash("sha256");
  hash.update(name);
  hash.update("\0");
  hash.update(stableFingerprintValue(input));
  return hash.digest("hex").slice(0, 24);
}

export function verificationCheckForTool(
  name: string,
  input: unknown,
): VerificationToolCheck | null {
  if (name === "predeploy_check") {
    return { kind: "build", fingerprint: toolCallFingerprint(name, input), passive: false };
  }
  if (name === "interact_preview" || name === "run_flow" || name === "screenshot_preview") {
    return {
      kind: "browser",
      fingerprint: toolCallFingerprint(name, input),
      passive: name === "screenshot_preview",
    };
  }
  if (name !== "run_command") return null;
  const command = String((input as { command?: unknown } | null)?.command ?? "");
  const kind = TEST_COMMAND.test(command) ? "test" : BUILD_COMMAND.test(command) ? "build" : null;
  return kind
    ? { kind, fingerprint: toolCallFingerprint(name, input), passive: false }
    : null;
}

/** Failures some tools report as normal text rather than thrown exceptions. */
export function toolResultIndicatesFailure(
  name: string,
  result: string,
  executionError = false,
): boolean {
  if (executionError) return true;
  if (
    (name === "predeploy_check" || name === "interact_preview" || name === "run_flow") &&
    /\b(?:RESULT|VERDICT):\s*FAILED\b/i.test(result)
  ) {
    return true;
  }
  if (name === "run_command") {
    return (
      /exit_code:\s*(?:null|[1-9]\d*)\b/i.test(result) ||
      /\[killed:\s*(?:timeout|aborted by user)/i.test(result)
    );
  }
  if (name === "wait_for_port") return /\btimeout waiting for port\b/i.test(result);
  if (name === "screenshot_preview") {
    return /WARNING:\s*The page returned an error:/i.test(result);
  }
  return false;
}

export class SemanticToolRetryTracker {
  private readonly failed = new Set<string>();

  constructor(private readonly maxFingerprints = 128) {}

  isRetry(fingerprint: string): boolean {
    return this.failed.has(fingerprint);
  }

  record(fingerprint: string, failed: boolean): void {
    if (!failed) {
      this.failed.delete(fingerprint);
      return;
    }
    if (this.failed.has(fingerprint)) return;
    if (this.failed.size >= this.maxFingerprints) {
      const oldest = this.failed.values().next().value as string | undefined;
      if (oldest) this.failed.delete(oldest);
    }
    this.failed.add(fingerprint);
  }
}

/** Tool calls whose wall time is verification rather than implementation work. */
export function isVerificationToolCall(name: string, input: unknown): boolean {
  if (VERIFICATION_TOOL_NAMES.has(name)) return true;
  return verificationCheckForTool(name, input) !== null;
}

/**
 * Partition model tool calls into ordered execution batches. Only explicitly
 * audited read-only tools can share a batch; all other/unknown calls are hard
 * singleton barriers. Promise.all preserves order within each returned batch.
 */
export function planToolExecutionBatches<T extends { name: string }>(
  calls: readonly T[],
): T[][] {
  const batches: T[][] = [];
  let reads: T[] = [];
  const flushReads = (): void => {
    if (reads.length === 0) return;
    batches.push(reads);
    reads = [];
  };
  for (const call of calls) {
    if (PARALLEL_READ_ONLY_TOOLS.has(call.name)) {
      reads.push(call);
      if (reads.length === MAX_PARALLEL_READ_TOOLS) flushReads();
      continue;
    }
    flushReads();
    batches.push([call]);
  }
  flushReads();
  return batches;
}
