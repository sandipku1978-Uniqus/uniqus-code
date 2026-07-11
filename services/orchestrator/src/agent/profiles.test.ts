import { describe, expect, it } from "vitest";
import {
  CAPABILITY_IDS,
  DEFAULT_PROGRESSIVE_HARNESS_PERCENT,
  LEGACY_AGENT_PROFILE,
  applyInheritedSubagentCohort,
  applyProgressiveProfileCohort,
  formatCapabilityCatalog,
  guidanceForCapabilities,
  mergeGuidancePacks,
  progressiveHarnessCohortKey,
  selectTaskProfile,
} from "./profiles.js";

describe("selectTaskProfile", () => {
  it("fails open to the complete legacy profile when the task is ambiguous", () => {
    expect(selectTaskProfile("Build me something useful")).toEqual(LEGACY_AGENT_PROFILE);
    expect(selectTaskProfile("Can you handle this?")).toEqual(LEGACY_AGENT_PROFILE);
    expect(selectTaskProfile("fix this")).toEqual(LEGACY_AGENT_PROFILE);
  });

  it("selects a progressive core profile for an explicit code investigation", () => {
    const profile = selectTaskProfile("Investigate the latency bug in src/agent/loop.ts");
    expect(profile.mode).toBe("progressive");
    expect(profile.capabilities).toEqual([]);
    expect(profile.guidance).toEqual([]);
  });

  it("does not let server-inlined @file contents change the user's task profile", () => {
    const profile = selectTaskProfile(
      "Investigate the latency bug\n\nThe user @-referenced these files; their current contents are inlined below.\n\n<file path=\"App.tsx\">responsive dashboard tailwind css</file>",
    );
    expect(profile.mode).toBe("progressive");
    expect(profile.capabilities).toEqual([]);
    expect(profile.guidance).toEqual([]);
  });

  it("preserves full design, preview, asset, and deploy support for explicit UI work", () => {
    const profile = selectTaskProfile("Restyle the responsive dashboard in src/App.tsx");
    expect(profile.mode).toBe("progressive");
    expect(profile.capabilities).toEqual(["design", "preview", "assets", "deployment"]);
    expect(profile.guidance).toEqual(["design", "preview", "assets", "deployment"]);
  });

  it("treats a validated selected preview element as explicit UI evidence", () => {
    const profile = selectTaskProfile("fix this", { selectedElement: true });
    expect(profile.mode).toBe("progressive");
    expect(profile.capabilities).toEqual(["design", "preview", "assets", "deployment"]);
    expect(profile.guidance).toEqual(["design", "preview", "assets", "deployment"]);
  });

  it("combines cross-cutting packs for authentication and payments", () => {
    const profile = selectTaskProfile("Add Supabase login and a Stripe checkout flow");
    expect(profile.mode).toBe("progressive");
    expect(profile.capabilities).toEqual([
      "preview",
      "integrations",
      "auth",
      "payments",
      "secrets",
      "deployment",
    ]);
    expect(profile.guidance).toEqual([
      "preview",
      "backend",
      "auth",
      "payments",
      "secrets",
      "deployment",
    ]);
  });
});

describe("capability metadata", () => {
  it("keeps every group discoverable in a constant catalog", () => {
    const catalog = formatCapabilityCatalog();
    for (const id of CAPABILITY_IDS) expect(catalog).toContain(`${id} —`);
  });

  it("maps loaded capabilities to canonical detailed guidance", () => {
    expect(guidanceForCapabilities(["deployment", "integrations", "design"])).toEqual([
      "design",
      "backend",
      "deployment",
    ]);
  });

  it("makes auth and payments fully loadable after a task expands mid-turn", () => {
    expect(guidanceForCapabilities(["auth"])).toEqual([
      "preview",
      "backend",
      "auth",
      "secrets",
      "deployment",
    ]);
    expect(guidanceForCapabilities(["payments"])).toEqual([
      "preview",
      "backend",
      "payments",
      "secrets",
      "deployment",
    ]);
  });

  it("does not install text-only bridge guidance on a native-vision model", () => {
    expect(guidanceForCapabilities(["vision"], { hasNativeVision: true })).toEqual([]);
    expect(guidanceForCapabilities(["vision"], { hasNativeVision: false })).toEqual([
      "vision",
    ]);
  });

  it("keeps system-resident dynamic guidance canonical and duplicate-free", () => {
    expect(mergeGuidancePacks(["backend", "deployment"], ["preview", "backend"])).toEqual([
      "preview",
      "backend",
      "deployment",
    ]);
  });
});

describe("progressive harness cohorting", () => {
  const candidate = selectTaskProfile("Investigate the latency bug in src/agent/loop.ts");

  it("defaults to a conservative treatment rollout with a real legacy control", () => {
    expect(DEFAULT_PROGRESSIVE_HARNESS_PERCENT).toBe(25);
  });

  it("uses a stable one-way session key instead of a per-run identifier", () => {
    const first = progressiveHarnessCohortKey("project-a", "session-a");
    const repeated = progressiveHarnessCohortKey("project-a", "session-a");
    const otherSession = progressiveHarnessCohortKey("project-a", "session-b");

    expect(first).toBe(repeated);
    expect(first).not.toBe(otherSession);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("project-a");
    expect(progressiveHarnessCohortKey("project-a", null)).toMatch(/^[0-9a-f]{64}$/);
    expect(progressiveHarnessCohortKey(null, null)).toBeNull();

    expect(applyProgressiveProfileCohort(candidate, first, 25)).toEqual(
      applyProgressiveProfileCohort(candidate, repeated, 25),
    );
  });

  it("keeps an explicit treatment and a quality control path", () => {
    expect(applyProgressiveProfileCohort(candidate, "run-a", 100)).toMatchObject({
      profile: { mode: "progressive" },
      cohort: "treatment",
    });
    expect(applyProgressiveProfileCohort(candidate, "run-a", 0)).toEqual({
      profile: LEGACY_AGENT_PROFILE,
      cohort: "control",
    });
  });

  it("labels ambiguous fail-open tasks as ineligible rather than control", () => {
    expect(applyProgressiveProfileCohort(LEGACY_AGENT_PROFILE, "run-a", 50)).toEqual({
      profile: LEGACY_AGENT_PROFILE,
      cohort: "ineligible",
    });
  });

  it("keeps specialized nested profiles inside the lead session's cohort", () => {
    expect(applyInheritedSubagentCohort(candidate, "treatment")).toBe(candidate);
    expect(applyInheritedSubagentCohort(candidate, "control")).toBe(
      LEGACY_AGENT_PROFILE,
    );
    expect(applyInheritedSubagentCohort(candidate, "ineligible")).toBe(
      LEGACY_AGENT_PROFILE,
    );
  });
});
