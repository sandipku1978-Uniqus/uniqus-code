import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./store";

describe("path-correlated editor loads", () => {
  beforeEach(() => {
    useStore.setState({
      selectedFile: null,
      fileContentPath: null,
      fileContent: "",
      fileRequest: null,
      fileLoadError: null,
      pendingEdits: {},
      saveStatus: {},
    });
  });

  it("ignores an out-of-order response for the previous tab", () => {
    const state = useStore.getState();
    state.startFileLoad("a.ts", 1);
    useStore.getState().startFileLoad("b.ts", 2);
    useStore.getState().setFile("a.ts", "old A", 1);

    expect(useStore.getState()).toMatchObject({
      selectedFile: "b.ts",
      fileContentPath: null,
      fileContent: "",
      fileRequest: { path: "b.ts", id: 2 },
    });

    useStore.getState().setFile("b.ts", "B", 2);
    expect(useStore.getState()).toMatchObject({
      selectedFile: "b.ts",
      fileContentPath: "b.ts",
      fileContent: "B",
      fileRequest: null,
    });
  });

  it("opens the path-keyed dirty buffer without exposing another file", () => {
    useStore.setState({ pendingEdits: { "b.ts": "unsaved B" } });
    useStore.getState().startFileLoad("b.ts", 3);
    expect(useStore.getState()).toMatchObject({
      selectedFile: "b.ts",
      fileContentPath: "b.ts",
      fileContent: "unsaved B",
      fileRequest: null,
    });
  });

  it("keeps project editor buffers when only chat state resets", () => {
    useStore.setState({
      pendingEdits: { "a.ts": "offline edit" },
      saveStatus: { "a.ts": { kind: "dirty" } },
    });
    useStore.getState().resetChat();
    expect(useStore.getState().pendingEdits).toEqual({ "a.ts": "offline edit" });
    expect(useStore.getState().saveStatus["a.ts"]).toEqual({ kind: "dirty" });
  });
});
