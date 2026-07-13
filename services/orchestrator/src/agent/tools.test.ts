import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS, LEGACY_AGENT_PROFILE, type AgentProfile } from "./profiles.js";
import {
  TOOLS,
  VISION_BRIDGE_TOOLS,
  createCapabilityToolState,
} from "./tools.js";

const researchProfile: AgentProfile = {
  mode: "progressive",
  capabilities: ["knowledge"],
  guidance: [],
  reason: "test",
};

describe("createCapabilityToolState", () => {
  it("preserves the complete historical order for a legacy profile", () => {
    const state = createCapabilityToolState(LEGACY_AGENT_PROFILE, true);
    expect(state.progressive).toBe(false);
    expect(state.tools().map((tool) => tool.name)).toEqual([
      ...TOOLS.map((tool) => tool.name),
      ...VISION_BRIDGE_TOOLS.map((tool) => tool.name),
    ]);
    expect(state.loadedCapabilities()).toEqual(CAPABILITY_IDS);
  });

  it("starts lean while keeping omitted groups discoverable and loadable", () => {
    const state = createCapabilityToolState(researchProfile, false);
    const names = state.tools().map((tool) => tool.name);
    expect(names).toContain("read_file");
    expect(names).toContain("knowledge_search");
    expect(names).toContain("load_capabilities");
    expect(names).not.toContain("start_server");
    expect(names).not.toContain("call_connector");
    expect(JSON.stringify(state.tools()).length).toBeLessThan(JSON.stringify(TOOLS).length / 2);
  });

  it("only appends new schemas, retaining the previous tool list as an exact prefix", () => {
    const state = createCapabilityToolState(researchProfile, false);
    const before = state.tools().map((tool) => tool.name);
    const loaded = state.load(["preview", "integrations"]);
    const after = state.tools().map((tool) => tool.name);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toContain("start_server");
    expect(after).toContain("call_connector");
    expect(loaded.added).toEqual(["preview", "integrations"]);
    expect(state.load(["preview"]).alreadyLoaded).toEqual(["preview"]);
  });

  it("adds vision schemas only for a text-only active model", () => {
    const withoutBridge = createCapabilityToolState(researchProfile, false);
    withoutBridge.load(["vision"]);
    expect(withoutBridge.tools().map((tool) => tool.name)).not.toContain("analyze_image");

    const withBridge = createCapabilityToolState(researchProfile, true);
    withBridge.load(["vision"]);
    expect(withBridge.tools().map((tool) => tool.name)).toContain("analyze_image");
  });

  it("loads the complete auth/payment rails from those domain groups", () => {
    const auth = createCapabilityToolState(researchProfile, false);
    auth.load(["auth"]);
    expect(auth.tools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "start_server",
        "interact_preview",
        "list_connectors",
        "call_connector",
        "list_secrets",
        "predeploy_check",
      ]),
    );

    const payments = createCapabilityToolState(researchProfile, false);
    payments.load(["payments"]);
    expect(payments.tools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["interact_preview", "call_connector", "list_secrets", "predeploy_check"]),
    );
  });
});
