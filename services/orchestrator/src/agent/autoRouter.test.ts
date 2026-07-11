import { describe, it, expect, vi } from "vitest";
import type { ProviderName } from "./providers/types.js";
import {
  classifyTaskHeuristic,
  mapToModel,
  availableProvidersFromKeys,
  turnReferencesImage,
  lastUserMessageText,
  pickAutoModel,
} from "./autoRouter.js";

const set = (...p: ProviderName[]): Set<ProviderName> => new Set(p);
// The production orchestrator today: Anthropic (always) + Z.ai.
const PROD = set("anthropic", "zai");
// All four providers configured.
const ALL = set("anthropic", "zai", "openai", "google");
const ANTHROPIC_ONLY = set("anthropic");

describe("classifyTaskHeuristic", () => {
  it("flags debugging / root-cause as hard", () => {
    expect(classifyTaskHeuristic("Debug why the checkout total is wrong")).toBe("hard");
    expect(classifyTaskHeuristic("the build keeps failing with a stack trace, fix it")).toBe("hard");
    expect(classifyTaskHeuristic("there's a race condition in the queue worker")).toBe("hard");
  });

  it("flags architecture / cross-cutting work as hard", () => {
    expect(classifyTaskHeuristic("Design the database schema for multi-tenant billing")).toBe("hard");
    expect(classifyTaskHeuristic("refactor the auth flow across the whole codebase")).toBe("hard");
  });

  it("routes trivial edits to the quick (fast-model) tier", () => {
    expect(classifyTaskHeuristic("change the button color to blue")).toBe("quick");
    expect(classifyTaskHeuristic("fix a typo in the header")).toBe("quick");
    expect(classifyTaskHeuristic("add a footer link")).toBe("quick");
  });

  it("routes explicitly speed-sensitive requests to quick", () => {
    expect(classifyTaskHeuristic("just a quick change to the nav order")).toBe("quick");
    expect(classifyTaskHeuristic("can you update the hero copy asap")).toBe("quick");
  });

  it("lets hard win over quick when both could match", () => {
    // "quickly" is a speed word, but debugging a race condition is hard work.
    expect(classifyTaskHeuristic("quickly debug the race condition in the worker")).toBe("hard");
  });

  it("does not escalate on length alone — a long but signal-free brief is ambiguous", () => {
    // Length is a weak proxy for difficulty; let the classify tiebreak decide
    // rather than force-routing a long routine brief to Opus.
    expect(classifyTaskHeuristic("Build ".concat("x".repeat(900)))).toBe("ambiguous");
  });

  it("still flags a long brief as hard when it carries a hard signal", () => {
    expect(
      classifyTaskHeuristic(
        "refactor the auth flow across the whole codebase. ".concat("x".repeat(900)),
      ),
    ).toBe("hard");
  });

  it("returns ambiguous for medium-length, signal-free requests", () => {
    expect(
      classifyTaskHeuristic(
        "Can you make the dashboard show the user's recent orders with pagination?",
      ),
    ).toBe("ambiguous");
  });

  it("defaults empty input to standard rather than calling the tiebreak", () => {
    expect(classifyTaskHeuristic("   ")).toBe("standard");
  });
});

describe("mapToModel — multi-provider, cost-aware policy", () => {
  it("sends quick work to Gemini 3.5 Flash when a Google key is present", () => {
    expect(mapToModel("quick", false, ALL)).toEqual({
      provider: "google",
      model: "gemini-3.5-flash",
      overridden: false,
    });
  });

  it("does not auto-pick GLM for standard work (zai is excluded from Auto for now)", () => {
    expect(mapToModel("standard", false, PROD)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      overridden: false,
    });
  });

  it("escalates hard work to Claude Opus", () => {
    expect(mapToModel("hard", false, PROD)).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
      overridden: false,
    });
  });

  it("uses Gemini Pro for hard work when Anthropic is absent (OpenAI is excluded from Auto for now)", () => {
    expect(mapToModel("hard", false, set("openai"))).toBeNull();
    expect(mapToModel("hard", false, set("google"))?.model).toBe(
      "gemini-3.1-pro-preview-customtools",
    );
  });

  it("does NOT route quick work to GLM (high first-token latency)", () => {
    // Z.ai-only: GLM isn't in the quick list, so it falls through to the
    // Anthropic terminal fallback rather than GLM.
    expect(mapToModel("quick", false, set("anthropic", "zai"))?.provider).not.toBe("zai");
  });

  it("never marks an Auto pick as overridden", () => {
    expect(mapToModel("hard", false, ALL)?.overridden).toBe(false);
    expect(mapToModel("quick", false, ALL)?.overridden).toBe(false);
    expect(mapToModel("standard", false, ALL)?.overridden).toBe(false);
  });

  it("prefers a native-vision model over text-only GLM for image-heavy turns", () => {
    // Standard + vision on prod (anthropic+zai) → Sonnet, not GLM.
    expect(mapToModel("standard", true, PROD)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      overridden: false,
    });
    // Quick + vision with Google → Gemini Flash (fast native vision).
    expect(mapToModel("quick", true, ALL)).toEqual({
      provider: "google",
      model: "gemini-3.5-flash",
      overridden: false,
    });
  });

  it("returns null on a zai-only orchestrator (Auto keeps the static floor, which is GLM there)", () => {
    // zai is excluded from the Auto tiers, so no pick resolves; pickAutoModel
    // then returns null and the caller keeps the static default (GLM+bridge).
    expect(mapToModel("standard", true, set("zai"))).toBeNull();
  });

  it("is cost-aware on an Anthropic-only orchestrator (Sonnet for quick/standard, Opus for hard)", () => {
    expect(mapToModel("quick", false, ANTHROPIC_ONLY)?.model).toBe("claude-sonnet-4-6");
    expect(mapToModel("standard", false, ANTHROPIC_ONLY)?.model).toBe("claude-sonnet-4-6");
    expect(mapToModel("hard", false, ANTHROPIC_ONLY)?.model).toBe("claude-opus-4-8");
  });

  it("returns null when only Auto-excluded providers have keys (caller keeps the static default)", () => {
    const openaiOnly = set("openai");
    expect(mapToModel("hard", false, openaiOnly)).toBeNull();
    expect(mapToModel("quick", false, openaiOnly)).toBeNull();
    expect(mapToModel("standard", false, openaiOnly)).toBeNull();
  });
});

describe("pickAutoModel attribution", () => {
  it("attributes an unavailable classifier fallback to the heuristic default", async () => {
    const picked = await pickAutoModel(
      "agent",
      {
        userMessage: "Add recent orders with pagination",
        hasImages: false,
        availableProviders: ANTHROPIC_ONLY,
      },
      {},
    );
    expect(picked).toMatchObject({ tier: "standard", source: "heuristic" });
  });

  it("keeps plan-mode ambiguous work on its hard heuristic without classifying", async () => {
    const onClassifier = vi.fn();
    const picked = await pickAutoModel(
      "plan",
      {
        userMessage: "Add recent orders with pagination",
        hasImages: false,
        availableProviders: ANTHROPIC_ONLY,
      },
      { onClassifier },
    );
    expect(picked).toMatchObject({ tier: "hard", source: "heuristic" });
    expect(onClassifier).not.toHaveBeenCalled();
  });
});

describe("availableProvidersFromKeys", () => {
  it("includes only providers with a truthy key", () => {
    const s = availableProvidersFromKeys({ anthropic: "k", zai: "k", openai: undefined });
    expect([...s].sort()).toEqual(["anthropic", "zai"]);
  });
});

describe("lastUserMessageText", () => {
  it("returns the last real user message, skipping tool_result wrappers", () => {
    const history = [
      { role: "user" as const, content: "build a todo app" },
      { role: "assistant" as const, content: "ok" },
      {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "t1", content: "done" }],
      },
    ];
    expect(lastUserMessageText(history)).toBe("build a todo app");
  });

  it("reads text blocks from a block-form user message", () => {
    const history = [
      { role: "user" as const, content: [{ type: "text" as const, text: "fix the login bug" }] },
    ];
    expect(lastUserMessageText(history)).toBe("fix the login bug");
  });

  it("is undefined for empty or missing history", () => {
    expect(lastUserMessageText([])).toBeUndefined();
    expect(lastUserMessageText(undefined)).toBeUndefined();
  });
});

describe("turnReferencesImage", () => {
  it("detects an uploaded image path in the message text", () => {
    expect(turnReferencesImage("match this design assets/uploads/mockup.png please")).toBe(true);
  });

  it("detects an image content block in recent history", () => {
    const history = [
      {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/png" as const, data: "" },
          },
        ],
      },
    ];
    expect(turnReferencesImage("what's wrong here?", history)).toBe(true);
  });

  it("is false for a plain text turn", () => {
    expect(turnReferencesImage("add a contact form", [])).toBe(false);
  });
});
