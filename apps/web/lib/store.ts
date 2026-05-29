"use client";

import { create } from "zustand";
import type {
  CurrentUser,
  DeploymentState,
  ModelChoice,
  Plan,
  PreviewServer,
  ProjectSummary,
  TodoItem,
  TreeEntry,
  UploadedFileSummary,
} from "@uniqus/api-types";
import { MODEL_CATALOG } from "@uniqus/api-types";

/**
 * The agent model choice is an account-wide default (the Settings "Default
 * model" card and the composer picker both edit it), so we persist it to
 * localStorage rather than resetting it per project. "auto" is the default.
 */
const MODEL_STORAGE_KEY = "uniqus.model";

function readStoredModel(): ModelChoice {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY) || "auto";
    if (stored === "auto" || MODEL_CATALOG.some((m) => m.id === stored)) {
      return stored;
    }
    return "auto";
  } catch {
    return "auto";
  }
}

function persistModel(model: ModelChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    /* private mode / quota — non-fatal, the choice just won't persist */
  }
}

/**
 * Appearance preferences (Settings → Appearance). Like the model default,
 * these are account-wide client preferences persisted to localStorage. They
 * are applied to <html> via `data-theme` / `data-density` attributes — the
 * CSS token overrides in globals.css key off those. An inline script in the
 * root layout reads the same keys to set the attributes before first paint
 * (no flash); the setters below keep the DOM in sync on live changes.
 */
export type ThemeChoice = "dark" | "light";
export type DensityChoice = "comfortable" | "compact";

const THEME_STORAGE_KEY = "uniqus.theme";
const DENSITY_STORAGE_KEY = "uniqus.density";

function readStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function readStoredDensity(): DensityChoice {
  if (typeof window === "undefined") return "comfortable";
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}

function applyTheme(theme: ThemeChoice): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

function applyDensity(density: DensityChoice): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = density;
}

function persistTheme(theme: ThemeChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

function persistDensity(density: DensityChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export interface DeploymentLive {
  id: string;
  state: DeploymentState;
  vercel_url: string | null;
  error_message: string | null;
}

export type ChatItem =
  | {
      kind: "user";
      id: string;
      content: string;
      attachments?: UploadedFileSummary[];
      fileRefs?: string[];
    }
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
  | {
      /**
       * Agent paused via the `ask_user` tool. Renders inline in the chat
       * with the question + options + free-text. Resolved by sending a
       * `user_question_answered` ClientEvent with the chosen answer; the
       * matching tool_result lands as a normal `tool` item afterward.
       */
      kind: "user_question";
      id: string;
      call_id: string;
      question: string;
      options?: string[];
      allow_free_text: boolean;
      answer?: string;
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
  /** Tasks pane (Plan §5 — Artifact panes UI). Renders the agent's todo_write list. */
  tasks: boolean;
}

interface State {
  connected: boolean;
  busy: boolean;
  mode: "plan-then-execute" | "execute-only";
  /**
   * Whether the user has explicitly chosen a plan/execute mode this session
   * (via the Plan toggle). Auto-defaults — e.g. "plan mode on for the first
   * turn of a brand-new project" — only apply when this is false, so we never
   * override a deliberate choice. Reset per project in `reset()`.
   */
  modeTouched: boolean;
  /**
   * Which model the agent runs on. `"auto"` lets the orchestrator pick the
   * best model per role; a catalog id ("<provider>:<model>") is an explicit
   * Advanced override. Persisted to localStorage as an account-wide default.
   */
  model: ModelChoice;
  /**
   * Appearance preferences (account-wide, localStorage-backed). `theme`
   * flips the CSS token set (dark/light); `density` tightens the global
   * spacing/type rhythm (comfortable/compact). Both are mirrored onto
   * <html> data-attributes so the CSS overrides cascade app-wide.
   */
  theme: ThemeChoice;
  density: DensityChoice;
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
  redeploySuggested: boolean;
  /** Agent-maintained todo list (Plan §5). Updated via `todos_updated` WS events. */
  todos: TodoItem[];

  setConnected(c: boolean): void;
  setBusy(b: boolean): void;
  /** Set mode programmatically (auto-defaults). Does NOT mark modeTouched. */
  setMode(m: "plan-then-execute" | "execute-only"): void;
  /** Set mode from a user action (the Plan toggle). Marks modeTouched. */
  setModeManual(m: "plan-then-execute" | "execute-only"): void;
  /** Set the agent model choice and persist it as the account-wide default. */
  setModel(m: ModelChoice): void;
  /** Set the UI theme; persists + applies to <html data-theme>. */
  setTheme(t: ThemeChoice): void;
  /** Set the UI density; persists + applies to <html data-density>. */
  setDensity(d: DensityChoice): void;
  addUserMessage(
    content: string,
    attachments?: UploadedFileSummary[],
    fileRefs?: string[],
  ): void;
  appendText(content: string): void;
  addToolCall(callId: string, name: string, input: unknown): void;
  setToolResult(callId: string, result: string, isError: boolean): void;
  addUserQuestion(
    callId: string,
    question: string,
    options: string[] | undefined,
    allowFreeText: boolean,
  ): void;
  resolveUserQuestion(callId: string, answer: string): void;
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
  setRedeploySuggested(value: boolean): void;
  setTodos(items: TodoItem[]): void;
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
  mode: "execute-only",
  modeTouched: false,
  model: readStoredModel(),
  // SSR-safe defaults: the persisted choice is applied to <html> before paint
  // by the layout bootstrap script, and hydrated into the store on mount via
  // hydrateAppearanceFromStorage() — initializing from localStorage here would
  // desync the first client render from the server HTML.
  theme: "dark",
  density: "comfortable",
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
  // Tasks pane auto-pops the first time the agent calls todo_write.
  panels: { files: true, terminal: false, tasks: false },
  user: null,
  project: null,
  lastSyncedAt: null,
  saveStatus: {},
  pendingEdits: {},
  expandedTurns: {},
  deployment: null,
  redeploySuggested: false,
  todos: [],

  setConnected: (c) => set({ connected: c }),
  setBusy: (b) => set({ busy: b }),
  setMode: (m) => set({ mode: m }),
  setModeManual: (m) => set({ mode: m, modeTouched: true }),
  setModel: (m) => {
    persistModel(m);
    set({ model: m });
  },
  setTheme: (t) => {
    persistTheme(t);
    applyTheme(t);
    set({ theme: t });
  },
  setDensity: (d) => {
    persistDensity(d);
    applyDensity(d);
    set({ density: d });
  },

  addUserMessage: (content, attachments, fileRefs) =>
    set((s) => ({
      chat: [
        ...s.chat,
        {
          kind: "user",
          id: id(),
          content,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
          fileRefs: fileRefs && fileRefs.length > 0 ? fileRefs : undefined,
        },
      ],
    })),

  appendText: (content) =>
    set((s) => {
      const last = s.chat[s.chat.length - 1];
      if (last && last.kind === "assistant_text") {
        const nextContent = last.content + content;
        return {
          chat: [...s.chat.slice(0, -1), { ...last, content: nextContent }],
          redeploySuggested:
            s.redeploySuggested || /\bredeploy\b|\bdeploy again\b/i.test(nextContent),
        };
      }
      return {
        chat: [...s.chat, { kind: "assistant_text", id: id(), content }],
        redeploySuggested:
          s.redeploySuggested || /\bredeploy\b|\bdeploy again\b/i.test(content),
      };
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

  addUserQuestion: (callId, question, options, allowFreeText) =>
    set((s) => {
      // Dedupe on call_id — the loop sends one `user_question_asked` per
      // ask_user call but defensive against retries / replays.
      if (s.chat.some((i) => i.kind === "user_question" && i.call_id === callId)) {
        return {};
      }
      return {
        chat: [
          ...s.chat,
          {
            kind: "user_question",
            id: id(),
            call_id: callId,
            question,
            options: options && options.length > 0 ? options : undefined,
            allow_free_text: allowFreeText,
          },
        ],
      };
    }),

  resolveUserQuestion: (callId, answer) =>
    set((s) => ({
      chat: s.chat.map((item) =>
        item.kind === "user_question" && item.call_id === callId
          ? { ...item, answer }
          : item,
      ),
    })),

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
  setRedeploySuggested: (value) => set({ redeploySuggested: value }),
  setTodos: (items) => set({ todos: items }),
  resetChat: () =>
    set({
      chat: [],
      pendingPlanItemId: null,
      terminalLines: [],
      expandedTurns: {},
      redeploySuggested: false,
    }),
  reset: () =>
    set({
      // Per-project fresh start so the first-turn plan default re-evaluates.
      mode: "execute-only",
      modeTouched: false,
      chat: [],
      tree: [],
      selectedFile: null,
      fileContent: "",
      terminalLines: [],
      pendingPlanItemId: null,
      previews: [],
      openFiles: [],
      editorTab: "",
      panels: { files: true, terminal: false, tasks: false },
      user: null,
      project: null,
      lastSyncedAt: null,
      saveStatus: {},
      pendingEdits: {},
      expandedTurns: {},
      deployment: null,
      redeploySuggested: false,
      todos: [],
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

/**
 * Pull the persisted Appearance prefs into the store after mount. The store
 * initializes to SSR-safe defaults (dark/comfortable) so the first client
 * render matches the server HTML; call this from a `useEffect` to reconcile
 * with localStorage once hydration is done. The DOM is already themed by the
 * layout bootstrap script, so this only syncs the in-memory state that the
 * Appearance controls read.
 */
export function hydrateAppearanceFromStorage(): void {
  const { theme, density, setTheme, setDensity } = useStore.getState();
  const storedTheme = readStoredTheme();
  const storedDensity = readStoredDensity();
  if (storedTheme !== theme) setTheme(storedTheme);
  if (storedDensity !== density) setDensity(storedDensity);
}
