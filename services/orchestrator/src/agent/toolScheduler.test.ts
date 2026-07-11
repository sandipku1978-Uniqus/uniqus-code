import { describe, expect, it } from "vitest";
import {
  MAX_PARALLEL_READ_TOOLS,
  PARALLEL_READ_ONLY_TOOLS,
  SemanticToolRetryTracker,
  isVerificationToolCall,
  planToolExecutionBatches,
  toolCallFingerprint,
  toolResultIndicatesFailure,
  verificationCheckForTool,
} from "./toolScheduler.js";

const calls = (...names: string[]) => names.map((name, index) => ({ id: String(index), name }));

describe("planToolExecutionBatches", () => {
  it("keeps stateful logs and potentially paid asset OCR as serial barriers", () => {
    expect(PARALLEL_READ_ONLY_TOOLS.has("read_server_log")).toBe(false);
    expect(PARALLEL_READ_ONLY_TOOLS.has("read_asset")).toBe(false);
  });
  it("batches consecutive audited reads with a hard concurrency cap of four", () => {
    const input = calls("read_file", "grep", "list_dir", "list_assets", "read_asset", "list_servers");
    const batches = planToolExecutionBatches(input);
    expect(batches.map((batch) => batch.length)).toEqual([MAX_PARALLEL_READ_TOOLS, 1, 1]);
    expect(batches.flat()).toEqual(input);
  });

  it("treats edits, commands, browser actions, connectors, and unknown tools as barriers", () => {
    const input = calls(
      "read_file",
      "grep",
      "write_file",
      "list_dir",
      "run_command",
      "screenshot_preview",
      "call_connector",
      "future_tool",
      "read_asset",
    );
    const batches = planToolExecutionBatches(input);
    expect(batches.map((batch) => batch.map((call) => call.name))).toEqual([
      ["read_file", "grep"],
      ["write_file"],
      ["list_dir"],
      ["run_command"],
      ["screenshot_preview"],
      ["call_connector"],
      ["future_tool"],
      ["read_asset"],
    ]);
    expect(batches.flat()).toEqual(input);
  });

  it("keeps result ordering even when concurrent reads finish out of order", async () => {
    const input = calls("read_file", "grep", "list_dir");
    const [batch] = planToolExecutionBatches(input);
    const delays = [25, 1, 10];
    const results = await Promise.all(
      batch.map(
        (call, index) =>
          new Promise<string>((resolve) => setTimeout(() => resolve(call.id), delays[index])),
      ),
    );
    expect(results).toEqual(input.map((call) => call.id));
  });
});

describe("isVerificationToolCall", () => {
  it("classifies browser/predeploy tools and test/build commands as verification", () => {
    expect(isVerificationToolCall("predeploy_check", {})).toBe(true);
    expect(isVerificationToolCall("interact_preview", {})).toBe(true);
    expect(isVerificationToolCall("run_command", { command: "npm run typecheck" })).toBe(true);
    expect(isVerificationToolCall("run_command", { command: "cargo test --workspace" })).toBe(true);
    expect(isVerificationToolCall("run_command", { command: "npm run build" })).toBe(true);
  });

  it("keeps implementation/install commands in the generic tool phase", () => {
    expect(isVerificationToolCall("run_command", { command: "npm install zod" })).toBe(false);
    expect(isVerificationToolCall("write_file", { path: "src/App.tsx" })).toBe(false);
  });

  it("uses bounded fingerprints so only the same check is a rerun", () => {
    const first = verificationCheckForTool("run_command", { command: "npm test" });
    const same = verificationCheckForTool("run_command", { command: "npm test" });
    const other = verificationCheckForTool("run_command", { command: "npm run lint" });
    expect(first).toMatchObject({ kind: "test", passive: false });
    expect(same?.fingerprint).toBe(first?.fingerprint);
    expect(other).toMatchObject({ kind: "build", passive: false });
    expect(other?.fingerprint).not.toBe(first?.fingerprint);
    expect(first?.fingerprint).toMatch(/^[a-f0-9]{24}$/);
  });

  it("treats screenshots as passive evidence and recognises their HTTP failures", () => {
    expect(verificationCheckForTool("screenshot_preview", { path: "/" })).toMatchObject({
      kind: "browser",
      passive: true,
    });
    expect(
      toolResultIndicatesFailure(
        "screenshot_preview",
        "WARNING: The page returned an error: HTTP 500",
      ),
    ).toBe(true);
  });
});

describe("semantic tool outcomes", () => {
  it("recognises normal-text command, assertion, and timeout failures", () => {
    expect(toolResultIndicatesFailure("run_command", "exit_code: 2\n--- stderr ---\nnope")).toBe(true);
    expect(toolResultIndicatesFailure("run_command", "exit_code: null\n[killed: timeout after 1ms]")).toBe(true);
    expect(toolResultIndicatesFailure("interact_preview", "RESULT: FAILED — assertion")).toBe(true);
    expect(toolResultIndicatesFailure("wait_for_port", "timeout waiting for port 4242")).toBe(true);
    expect(toolResultIndicatesFailure("run_command", "exit_code: 0\nall good")).toBe(false);
    expect(toolResultIndicatesFailure("read_file", "const status = 'RESULT: FAILED';")).toBe(false);
  });

  it("counts only attempts after the same failed fingerprint as semantic retries", () => {
    const tracker = new SemanticToolRetryTracker();
    const first = toolCallFingerprint("run_command", { command: "npm test" });
    const corrected = toolCallFingerprint("run_command", { command: "npm test -- --runInBand" });
    expect(tracker.isRetry(first)).toBe(false);
    tracker.record(first, true);
    expect(tracker.isRetry(first)).toBe(true);
    expect(tracker.isRetry(corrected)).toBe(false);
    tracker.record(first, false);
    expect(tracker.isRetry(first)).toBe(false);
  });
});
