"use client";

import { create } from "zustand";
import type {
  CurrentUser,
  DeploymentState,
  Plan,
  PreviewServer,
  ProjectSummary,
  TreeEntry,
} from "@uniqus/api-types";

export interface DeploymentLive {
  id: string;
  state: DeploymentState;
  vercel_url: string | null;
  error_message: string | null;
}

export type ChatItem =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant_text"; id: string; content: string }
  | {
      kind: "tool";
      id: string;
      call_id: string;
      name: string;
      input: unknown;
      result?: string;
      is_error?: boolean;
    }
  | { kind: "plan_proposal"; id: string; plan: Plan; status: "pending" | "approved" }
  | { kind: "system"; id: string; content: string }
  /**
   * Marks the end of a "turn" — everything between two `complete` markers (or
   * between a user message and the next complete) is foldable in the UI.
   * Inserted client-side when the `complete` server event fires.
   */
  | { kind: "complete"; id: string; tool_calls: number; elapsed_ms: number; aborted: boolean };

/** Per-file save status for the user-edit auto-save flow. */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Optional panels in the IDE. Default both off — the IDE is chat-centric and
 * users opt into the explorer / terminal.
 */
export interface PanelVisibility {
  files: boolean;
  terminal: boolean;
}

interface State {
  connected: boolean;
  busy: boolean;
  mode: "plan-then-execute" | "execute-only";
  chat: ChatItem[];
  tree: TreeEntry[];
  selectedFile: string | null;
  fileContent: string;
  terminalLines: string[];
  pendingPlanItemId: string | null;
  previews: PreviewServer[];
  /**
   * Files the user has opened as tabs in the editor area. Independent from
   * selectedFile — `selectedFile` is the most recently focused file (used to
   * load content); `openFiles` is the tab strip.
   */
  openFiles: string[];
  /** Active tab id in the editor area: "file:<path>" or "preview:<id>". */
  editorTab: string;
  panels: PanelVisibility;
  user: CurrentUser | null;
  project: ProjectSummary | null;
  /** Epoch ms of the last storage_synced event we received, or null. */
  lastSyncedAt: number | null;
  /** Per-path save status for the user-edit auto-save flow. */
  saveStatus: Record<string, SaveStatus>;
  /**
   * Holds the user's typed-but-not-yet-saved content per file. Lives at the
   * store level (not inside the editor) so the tab strip can flush a pending
   * edit from outside the editor — the dirty-dot save button reads this.
   */
  pendingEdits: Record<string, string>;
  /**
   * Whether the user has expanded a previously completed turn. Keyed by the
   * `complete` chat item id. Default = collapsed once the turn is done.
   */
  expandedTurns: Record<string, boolean>;
  /**
   * Live state of the current/most-recent deploy for this project. Updated
   * by the WS `deploy_state_changed` event so the Deploy button can show
   * "Deploying…" / "Live at xyz.vercel.app" without polling.
   */
  deployment: DeploymentLive | null;

  setConnected(c: boolean): void;
  setBusy(b: boolean): void;
  setMode(m: "plan-then-execute" | "execute-only"): void;
  addUserMessage(content: string): void;
  appendText(content: string): void;
  addToolCall(callId: string, name: string, input: unknown): void;
  setToolResult(callId: string, result: string, isError: boolean): void;
  addPlanProposal(plan: Plan): void;
  approvePendingPlan(plan: Plan): void;
  addSystem(content: string): void;
  addCompleteMarker(toolCalls: number, elapsedMs: number, aborted: boolean): void;
  setTree(entries: TreeEntry[]): void;
  setFile(path: string | null, content: string): void;
  appendTerminalLine(line: string): void;
  addPreview(p: PreviewServer): void;
  removePreview(id: string): void;
  openFile(path: string): void;
  closeOpenFile(path: string): void;
  setEditorTab(tab: string): void;
  togglePanel(name: keyof PanelVisibility): void;
  setPanel(name: keyof PanelVisibility, value: boolean): void;
  setUser(u: CurrentUser | null): void;
  setProject(p: ProjectSummary | null): void;
  setLastSyncedAt(at: number): void;
  setSaveStatus(path: string, status: SaveStatus): void;
  setPendingEdit(path: string, content: string): void;
  clearPendingEdit(path: string): void;
  toggleTurn(completeItemId: string): void;
  setDeployment(d: DeploymentLive | null): void;
  resetChat(): void;
  reset(): void;
}

let nextId = 1;
const id = () => `i${nextId++}`;

export const fileTabId = (path: string): string => `file:${path}`;
export const previewTabId = (serverId: string): string => `preview:${serverId}`;

export const useStore = create<State>((set, get) => ({
  connected: false,
  busy: false,
  mode: "plan-then-execute",
  chat: [],
  tree: [],
  selectedFile: null,
  fileContent: "",
  terminalLines: [],
  pendingPlanItemId: null,
  previews: [],
  openFiles: [],
  editorTab: "",
  // Files panel defaults ON: a builder shell with no visible file tree on
  // first paint feels empty even when the project has hundreds of files.
  // Terminal stays opt-in (it's currently a log viewer, not a real shell).
  panels: { files: true, terminal: false },
  user: null,
  project: null,
  lastSyncedAt: null,
  saveStatus: {},
  pendingEdits: {},
  expandedTurns: {},
  deployment: null,

  setConnected: (c) => set({ connected: c }),
  setBusy: (b) => set({ busy: b }),
  setMode: (m) => set({ mode: m }),

  addUserMessage: (content) =>
    set((s) => ({ chat: [...s.chat, { kind: "user", id: id(), content }] })),

  appendText: (content) =>
    set((s) => {
      const last = s.chat[s.chat.length - 1];
      if (last && last.kind === "assistant_text") {
        return {
          chat: [...s.chat.slice(0, -1), { ...last, content: last.content + content }],
        };
      }
      return { chat: [...s.chat, { kind: "assistant_text", id: id(), content }] };
    }),

  addToolCall: (callId, name, input) =>
    set((s) => {
      // Streaming flow: the orchestrator sends `tool_call` once with empty
      // input the moment the model starts emitting the tool block, then again
      // with the full input when streaming finishes. Dedupe on call_id and
      // upgrade the existing row in place rather than appending a duplicate.
      const idx = s.chat.findIndex(
        (item) => item.kind === "tool" && item.call_id === callId,
      );
      if (idx >= 0) {
        const existing = s.chat[idx] as Extract<ChatItem, { kind: "tool" }>;
        const next: ChatItem = { ...existing, name, input };
        return { chat: [...s.chat.slice(0, idx), next, ...s.chat.slice(idx + 1)] };
      }
      return {
        chat: [...s.chat, { kind: "tool", id: id(), call_id: callId, name, input }],
      };
    }),

  setToolResult: (callId, result, isError) => {
    set((s) => ({
      chat: s.chat.map((item) =>
        item.kind === "tool" && item.call_id === callId
          ? { ...item, result, is_error: isError }
          : item,
      ),
    }));
    const item = get().chat.find((i) => i.kind === "tool" && i.call_id === callId);
    if (item && item.kind === "tool" && item.name === "run_command") {
      get().appendTerminalLine(`$ ${(item.input as { command?: string })?.command ?? ""}`);
      get().appendTerminalLine(result);
      get().appendTerminalLine("");
    }
  },

  addPlanProposal: (plan) => {
    const itemId = id();
    set((s) => ({
      chat: [...s.chat, { kind: "plan_proposal", id: itemId, plan, status: "pending" }],
      pendingPlanItemId: itemId,
    }));
  },

  approvePendingPlan: (plan) =>
    set((s) => ({
      chat: s.chat.map((item) =>
        item.kind === "plan_proposal" && item.id === s.pendingPlanItemId
          ? { ...item, plan, status: "approved" }
          : item,
      ),
      pendingPlanItemId: null,
    })),

  addSystem: (content) =>
    set((s) => ({ chat: [...s.chat, { kind: "system", id: id(), content }] })),

  addCompleteMarker: (toolCalls, elapsedMs, aborted) =>
    set((s) => ({
      chat: [
        ...s.chat,
        {
          kind: "complete",
          id: id(),
          tool_calls: toolCalls,
          elapsed_ms: elapsedMs,
          aborted,
        },
      ],
    })),

  setTree: (entries) => set({ tree: entries }),
  setFile: (path, content) => set({ selectedFile: path, fileContent: content }),
  appendTerminalLine: (line) =>
    set((s) => ({ terminalLines: [...s.terminalLines.slice(-499), line] })),

  addPreview: (p) =>
    set((s) => {
      const exists = s.previews.find((x) => x.id === p.id);
      const previews = exists ? s.previews : [...s.previews, p];
      // Auto-switch to the new preview tab so the user sees their server immediately.
      return { previews, editorTab: previewTabId(p.id) };
    }),
  removePreview: (id) =>
    set((s) => {
      const previews = s.previews.filter((x) => x.id !== id);
      const wasActive = s.editorTab === previewTabId(id);
      let editorTab = s.editorTab;
      if (wasActive) {
        editorTab = previews[0]
          ? previewTabId(previews[0].id)
          : s.openFiles[0]
          ? fileTabId(s.openFiles[0])
          : "";
      }
      return { previews, editorTab };
    }),

  openFile: (path) =>
    set((s) => {
      const openFiles = s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path];
      return { openFiles, editorTab: fileTabId(path) };
    }),
  closeOpenFile: (path) =>
    set((s) => {
      const openFiles = s.openFiles.filter((p) => p !== path);
      let editorTab = s.editorTab;
      if (s.editorTab === fileTabId(path)) {
        editorTab = openFiles[0]
          ? fileTabId(openFiles[0])
          : s.previews[0]
          ? previewTabId(s.previews[0].id)
          : "";
      }
      return { openFiles, editorTab };
    }),
  setEditorTab: (tab) => set({ editorTab: tab }),

  togglePanel: (name) =>
    set((s) => ({ panels: { ...s.panels, [name]: !s.panels[name] } })),
  setPanel: (name, value) =>
    set((s) => ({ panels: { ...s.panels, [name]: value } })),

  setUser: (u) => set({ user: u }),
  setProject: (p) => set({ project: p }),
  setLastSyncedAt: (at) => set({ lastSyncedAt: at }),
  setSaveStatus: (path, status) =>
    set((s) => ({ saveStatus: { ...s.saveStatus, [path]: status } })),
  setPendingEdit: (path, content) =>
    set((s) => ({ pendingEdits: { ...s.pendingEdits, [path]: content } })),
  clearPendingEdit: (path) =>
    set((s) => {
      if (!(path in s.pendingEdits)) return {};
      const next = { ...s.pendingEdits };
      delete next[path];
      return { pendingEdits: next };
    }),
  toggleTurn: (completeItemId) =>
    set((s) => ({
      expandedTurns: {
        ...s.expandedTurns,
        [completeItemId]: !s.expandedTurns[completeItemId],
      },
    })),
  setDeployment: (d) => set({ deployment: d }),
  resetChat: () =>
    set({
      chat: [],
      pendingPlanItemId: null,
      terminalLines: [],
      expandedTurns: {},
    }),
  reset: () =>
    set({
      chat: [],
      tree: [],
      selectedFile: null,
      fileContent: "",
      terminalLines: [],
      pendingPlanItemId: null,
      previews: [],
      openFiles: [],
      editorTab: "",
      panels: { files: true, terminal: false },
      user: null,
      project: null,
      lastSyncedAt: null,
      saveStatus: {},
      pendingEdits: {},
      expandedTurns: {},
      deployment: null,
    }),
}));

/**
 * Send the most recent buffered content for `path` to the orchestrator now,
 * skipping any pending debounce. Safe to call when there's nothing buffered
 * (it's a no-op). Defers if the agent is mid-turn — `flushAllPendingEdits`
 * runs when the agent goes idle and replays whatever's still dirty.
 *
 * Lives outside the store so it can `import { send }` from ws-client without
 * creating a circular dep through the store module.
 */
export async function flushSave(path: string): Promise<void> {
  const { pendingEdits, busy, connected, setSaveStatus, clearPendingEdit } =
    useStore.getState();
  const content = pendingEdits[path];
  if (content === undefined) return;
  if (busy) {
    // Agent is running — leave it dirty. flushAllPendingEdits picks it up
    // when busy flips to false.
    setSaveStatus(path, { kind: "dirty" });
    return;
  }
  if (!connected) {
    // Socket is down. Surface the failure so the user knows their edit
    // didn't land instead of letting it sit silently in pendingEdits.
    setSaveStatus(path, {
      kind: "error",
      message: "disconnected — edit not saved (will retry when reconnected)",
    });
    return;
  }
  setSaveStatus(path, { kind: "saving" });
  // Lazy import keeps the store module free of WS deps.
  const { send } = await import("./ws-client");
  const ok = send({ type: "client_write_file", path, content });
  if (!ok) {
    setSaveStatus(path, {
      kind: "error",
      message: "send failed — edit not saved",
    });
    return;
  }
  clearPendingEdit(path);
}

/**
 * Flush every dirty buffer through the saver. Called when the agent finishes
 * a turn (busy → false) and when the socket reconnects, so edits the user
 * made during downtime aren't stranded only in client state.
 */
export async function flushAllPendingEdits(): Promise<void> {
  const paths = Object.keys(useStore.getState().pendingEdits);
  for (const p of paths) {
    await flushSave(p).catch(() => {});
  }
}
