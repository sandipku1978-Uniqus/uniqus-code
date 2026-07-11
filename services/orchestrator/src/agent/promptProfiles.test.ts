import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  createOwnedSubAgentDrain,
  hasMeaningfulFinalAnswer,
  hasPreResolvedAutoPick,
  inheritedSubAgentPermissionHooks,
  isNestedAgentRun,
} from "./loop.js";
import {
  LEGACY_AGENT_PROFILE,
  guidanceForCapabilities,
  selectTaskProfile,
} from "./profiles.js";

function promptFor(message: string): string {
  const profile = selectTaskProfile(message);
  return buildSystemPrompt(
    null,
    null,
    false,
    true,
    null,
    null,
    [],
    [],
    false,
    false,
    false,
    null,
    profile,
    profile.guidance,
  );
}

describe("progressive system prompt", () => {
  it("retains the concise universal safety, root-cause, verification, accessibility, and serverless invariants", () => {
    const prompt = promptFor("Investigate the latency bug in loop.ts");
    expect(prompt).toContain("Never reveal, print, upload, log");
    expect(prompt).toContain("Fix root causes");
    expect(prompt).toContain("Verify in proportion to risk");
    expect(prompt).toContain("accessible semantics");
    expect(prompt).toContain("deploy to serverless infrastructure");
    expect(prompt).toContain("load_capabilities");
    expect(prompt).not.toContain("Visual craft — distinctive by default");
  });

  it("keeps the complete detailed visual craft playbook for explicit frontend work", () => {
    const prompt = promptFor("Restyle the responsive dashboard in App.tsx");
    expect(prompt).toContain("Visual craft — distinctive by default");
    expect(prompt).toContain("Commit to an art direction BEFORE writing code");
    expect(prompt).toContain("Preview and browser verification");
  });

  it("preserves the full historical prompt for uncertain work", () => {
    const prompt = promptFor("Build me something useful");
    expect(prompt).toContain("Visual craft — distinctive by default");
    expect(prompt).toContain('"Add login" recipe');
    expect(prompt).toContain("Preview-server reliability checklist");
  });

  it("materially reduces irrelevant prompt text for an explicit non-UI task", () => {
    const lean = promptFor("Investigate the latency bug in loop.ts");
    const legacy = promptFor("Build me something useful");
    expect(lean.length).toBeLessThan(legacy.length / 2);
  });

  it("retains account, attached-library, and project constraints in a lean sub-agent prompt", () => {
    const profile = selectTaskProfile("Audit the code in loop.ts");
    const prompt = buildSystemPrompt(
      "PROJECT_SKILL_SENTINEL",
      "ACCOUNT_RULE_SENTINEL",
      false,
      true,
      { fullName: "example/repo", url: "https://example.invalid/repo" },
      null,
      [{ name: "library", body: "LIBRARY_SKILL_SENTINEL" }],
      [],
      false,
      false,
      false,
      "SUBAGENT_PERSONA_SENTINEL",
      profile,
      profile.guidance,
    );
    expect(prompt).toContain("ACCOUNT_RULE_SENTINEL");
    expect(prompt).toContain("LIBRARY_SKILL_SENTINEL");
    expect(prompt).toContain("PROJECT_SKILL_SENTINEL");
    expect(prompt).toContain("SUBAGENT_PERSONA_SENTINEL");
    expect(prompt).toContain("example/repo");
  });

  it("does not advertise lead-owned preview actions in a general sub-agent prompt", () => {
    const prompt = buildSystemPrompt(
      null,
      null,
      false,
      true,
      null,
      null,
      [],
      [],
      false,
      false,
      false,
      null,
      LEGACY_AGENT_PROFILE,
      LEGACY_AGENT_PROFILE.guidance,
      false,
    );
    expect(prompt).toContain("owned by the lead agent and unavailable");
    expect(prompt).not.toContain("ALWAYS use start_server");
    expect(prompt).not.toContain("start_server must run");
    expect(prompt).not.toContain("If a web app should be previewed, use start_server");
  });

  it("renders dynamically loaded guidance in non-compactable system context", () => {
    const profile = selectTaskProfile("Investigate latency in loop.ts");
    const prompt = buildSystemPrompt(
      null,
      null,
      false,
      true,
      null,
      null,
      [],
      [],
      false,
      false,
      false,
      null,
      profile,
      guidanceForCapabilities(["auth"]),
    );
    expect(prompt).toContain("End-user authentication (generated app)");
    expect(prompt).toContain("complete login, signup, forgot-password");
  });

  it("renders a sub-agent-safe preview recipe for dynamically loaded auth", () => {
    const profile = selectTaskProfile("Investigate latency in loop.ts");
    const prompt = buildSystemPrompt(
      null,
      null,
      false,
      true,
      null,
      null,
      [],
      [],
      false,
      false,
      false,
      null,
      profile,
      guidanceForCapabilities(["auth"]),
      false,
    );
    expect(prompt).toContain("Lead-owned preview verification");
    expect(prompt).not.toContain("start_server must run");
  });
});

describe("nested-agent ownership", () => {
  it("inherits live permission hooks without adding a user-question escape hatch", () => {
    const getPermissionMode = () => "default" as const;
    const requestToolApproval = async () => ({ decision: "approve" as const });
    const inherited = inheritedSubAgentPermissionHooks({
      getPermissionMode,
      requestToolApproval,
    });
    expect(inherited).toEqual({ getPermissionMode, requestToolApproval });
    expect(inherited).not.toHaveProperty("requestUserAnswer");
  });

  it("marks only explicit spawned roles as nested metric contributors", () => {
    expect(isNestedAgentRun({})).toBe(false);
    expect(isNestedAgentRun({ subAgentType: "backend" })).toBe(true);
  });

  it("aborts and drains owned workers exactly once before settlement", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const child = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseDurability!: () => void;
    const durable = new Promise<void>((resolve) => {
      releaseDurability = resolve;
    });
    const settled: string[] = [];
    const drain = createOwnedSubAgentDrain({
      controller,
      tasks: () => [child],
      onSettled: async () => {
        settled.push("sync-started");
        await durable;
        settled.push("durable");
      },
    });

    const first = drain("provider failure");
    const repeated = drain("another failure");
    expect(repeated).toBe(first);
    expect(controller.signal.aborted).toBe(true);
    expect(settled).toEqual([]);

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toEqual(["sync-started"]);
    releaseDurability();
    await first;
    expect(settled).toEqual(["sync-started", "durable"]);
  });
});

describe("pre-resolved Auto option", () => {
  it("distinguishes absence from an explicit null fallback", () => {
    expect(hasPreResolvedAutoPick({})).toBe(false);
    expect(hasPreResolvedAutoPick({ preResolvedAutoPick: null })).toBe(true);
    expect(
      hasPreResolvedAutoPick({
        preResolvedAutoPick: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          overridden: false,
          tier: "standard",
          vision: false,
        },
      }),
    ).toBe(true);
  });
});

describe("terminal final-answer detection", () => {
  it("accepts real text and rejects empty/refusal placeholders", () => {
    expect(hasMeaningfulFinalAnswer("Done — the fix is verified.")).toBe(true);
    expect(hasMeaningfulFinalAnswer("   ")).toBe(false);
    expect(
      hasMeaningfulFinalAnswer([{ type: "text", text: "(no response)" }]),
    ).toBe(false);
    expect(hasMeaningfulFinalAnswer([])).toBe(false);
  });

  it("does not mistake thinking-only terminal content for a final answer", () => {
    expect(
      hasMeaningfulFinalAnswer([
        { type: "thinking", thinking: "I should answer next", signature: "sig" } as any,
      ]),
    ).toBe(false);
  });
});
