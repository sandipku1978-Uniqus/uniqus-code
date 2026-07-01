"use client";

import { create } from "zustand";
import type {
  ChangedFile,
  CurrentUser,
  DeploymentState,
  ModelChoice,
  PermissionMode,
  Plan,
  PreviewServer,
  ProjectSummary,
  ThinkingEffort,
  ToolRiskCategory,
  TodoItem,
  TreeEntry,
  UploadedFileSummary,
} from "@uniqus/api-types";
import { MODEL_CATALOG, runModeForPermission } from "@uniqus/api-types";

/** The mode a brand-new turn falls back to once the first (Plan) turn is past. */
const DEFAULT_PERMISSION_MODE: PermissionMode = "acceptEdits";

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
 * Reasoning effort is an account-wide default like the model choice: the
 * composer's thinking control and (potentially) Settings both edit it, so it's
 * persisted to localStorage rather than reset per project. "medium" is the
 * default — a balance of quality and latency/cost.
 */
const THINKING_STORAGE_KEY = "uniqus.thinking";
const THINKING_ENABLED_STORAGE_KEY = "uniqus.thinkingEnabled";
const THINKING_LEVELS: ThinkingEffort[] = ["low", "medium", "high", "xhigh", "max"];

function readStoredThinking(): ThinkingEffort {
  if (typeof window === "undefined") return "medium";
  try {
    const stored = window.localStorage.getItem(THINKING_STORAGE_KEY);
    return THINKING_LEVELS.includes(stored as ThinkingEffort)
      ? (stored as ThinkingEffort)
      : "medium";
  } catch {
    return "medium";
  }
}

function persistThinking(thinking: ThinkingEffort): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THINKING_STORAGE_KEY, thinking);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Thinking on/off toggle — persisted account-wide like the effort level. */
function readStoredThinkingEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Default ON: only an explicit "false" turns it off.
    return window.localStorage.getItem(THINKING_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function persistThinkingEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THINKING_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/**
 * Active dashboard workspace (P3.1): `null` = the user's Personal workspace,
 * otherwise an organization id. Like the model default it's an account-wide
 * client preference persisted to localStorage, so the workspace you were last
 * looking at survives reloads. Only the dashboard (ProjectPicker) reads it; the
 * id is reconciled against the user's actual org list on load (a stale id from a
 * left/deleted org falls back to Personal).
 */
const WORKSPACE_STORAGE_KEY = "uniqus.workspace";

function readStoredWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return stored && stored !== "personal" ? stored : null;
  } catch {
    return null;
  }
}

function persistWorkspace(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    else window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
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
  /** Vercel inspector/build-logs URL, when known (set on a fresh deploy start). */
  inspector_url?: string | null;
}

/**
 * A DOM element the user picked out of the live preview via the element
 * picker. The shape mirrors the `uniqus:element` postMessage the proxy-injected
 * script emits (see PreviewPanel) — selector + light metadata, no pixels.
 *
 * It's set from PreviewPanel and consumed in ChatPanel, which attaches it to
 * the next turn as a `selected_element` block on the `user_message` so the
 * agent knows exactly which on-screen element the user means. `rect` is in the
 * iframe's own CSS pixels at pick time (used for the highlight overlay and to
 * crop a screenshot to the element).
 */
export interface SelectedElement {
  /** A CSS selector that uniquely targets the element inside the preview. */
  selector: string;
  /** Lowercased tag name, e.g. "button", "div". */
  tag: string;
  /** The element's class list (without the leading dot). */
  classes: string[];
  /** The element's id attribute, or null if it has none. */
  id: string | null;
  /** Bounding box in iframe CSS px at pick time. */
  rect: { x: number; y: number; width: number; height: number };
  /** Trimmed, truncated text content — a human hint of what was clicked. */
  text: string;
  /** Live computed styles for the inspector read-out (P4.1). */
  computedStyles?: Record<string, string>;
}

export type ChatItem =
  | {
      kind: "user";
      id: string;
      content: string;
      attachments?: UploadedFileSummary[];
      fileRefs?: string[];
      /** Element picked from the preview and sent with this turn, if any. */
      selectedElement?: SelectedElement;
      /** Epoch ms the message was sent (live turns only; absent on replay). */
      at?: number;
    }
  | { kind: "assistant_text"; id: string; content: string }
  | {
      /**
       * The model's reasoning trace (Anthropic adaptive thinking / Gemini
       * thought summaries), accumulated from `thinking` events. Rendered as a
       * collapsible block ahead of the assistant's answer for that step.
       */
      kind: "reasoning";
      id: string;
      content: string;
    }
  | {
      kind: "tool";
      id: string;
      call_id: string;
      name: string;
      input: unknown;
      result?: string;
      is_error?: boolean;
      /** Lines added/removed for write_file/edit_file — rendered as a "+A −R" badge. */
      lines_added?: number;
      lines_removed?: number;
      /** Sandbox-relative image paths to show as inline thumbnails (screenshot_preview
       *  / vision tools only). Loaded via the project's /raw/ endpoint. */
      imagePaths?: string[];
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
  | {
      kind: "plan_proposal";
      id: string;
      plan: Plan;
      status: "pending" | "approved" | "rejected";
    }
  | {
      /**
       * The agent paused on a tool call the current permission mode gates (an
       * edit in `default`, a dangerous op in `default`/`acceptEdits`). Renders an
       * approval card; resolved by a `tool_approval_response`. `decision` is set
       * once answered so the card freezes its verdict. Auto-resolves to
       * "approve" if the matching tool_result lands first (the user switched to a
       * permissive mode, which auto-approved it server-side).
       */
      kind: "tool_approval";
      id: string;
      call_id: string;
      tool: string;
      category: ToolRiskCategory;
      summary: string;
      reason: string;
      input: unknown;
      decision?: "approve" | "approve_always" | "deny";
    }
  | { kind: "system"; id: string; content: string }
  /**
   * Auto routing's per-turn model pick (from the `model_selected` WS event),
   * rendered as a compact "⚡ Auto → <model>" chip at the top of the turn so the
   * user can see which model Auto chose for the task. Only present on Auto turns.
   */
  | {
      kind: "routing";
      id: string;
      provider: string;
      model: string;
      tier?: "quick" | "standard" | "hard";
      vision?: boolean;
    }
  /**
   * A run-level failure (C7), rendered as a friendly card (title + plain-English
   * cause + collapsible raw detail + Retry/Simplify actions) instead of a bare
   * muted `error: <raw>` line. `code` selects the copy; `retryable` hints whether
   * a retry is likely to help.
   */
  | {
      kind: "error";
      id: string;
      message: string;
      code?: string;
      retryable?: boolean;
    }
  /**
   * Marks the end of a "turn" — everything between two `complete` markers (or
   * between a user message and the next complete) is foldable in the UI.
   * Inserted client-side when the `complete` server event fires.
   */
  | {
      kind: "complete";
      id: string;
      tool_calls: number;
      elapsed_ms: number;
      aborted: boolean;
      /** Final token usage for the turn; absent on replayed turns. */
      input_tokens?: number;
      output_tokens?: number;
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
      /** Provider-native model id that served the turn (C5). */
      model?: string;
      /** Estimated USD cost for this run (C5) — an estimate, not a charge. */
      cost_usd?: number;
      /**
       * Sub-agent spend folded into this turn (Phase 1). `cost_usd` is the lead
       * agent's cost; the turn's true cost is `cost_usd + subagent_cost_usd`.
       */
      subagent_count?: number;
      subagent_input_tokens?: number;
      subagent_output_tokens?: number;
      subagent_cost_usd?: number;
      /** Deterministic per-turn changeset, tool-derived (C6 Tier-1). */
      changed_files?: ChangedFile[];
      /** Context-aware follow-up prompt chips (C2). */
      suggestions?: string[];
    };

/**
 * One line in the Logs pane. `stream` distinguishes the `$ command` prompt
 * (cmd), normal stdout (out), and stderr / a failed command (err) so the panel
 * can colour them differently (UI/UX audit §C).
 */
export interface TerminalLine {
  text: string;
  stream: "cmd" | "out" | "err";
}

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

/**
 * Panel visibility is an account-wide layout preference (UI/UX audit §B): a
 * user who closes Files/Logs expects them to stay closed across reloads and
 * project switches. Persisted to localStorage like the model/thinking prefs.
 */
const PANELS_STORAGE_KEY = "uniqus.panels";
const DEFAULT_PANELS: PanelVisibility = { files: true, terminal: false };

function readStoredPanels(): PanelVisibility {
  if (typeof window === "undefined") return { ...DEFAULT_PANELS };
  try {
    const raw = window.localStorage.getItem(PANELS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PANELS };
    const parsed = JSON.parse(raw) as Partial<PanelVisibility>;
    return {
      files: typeof parsed.files === "boolean" ? parsed.files : DEFAULT_PANELS.files,
      terminal:
        typeof parsed.terminal === "boolean" ? parsed.terminal : DEFAULT_PANELS.terminal,
    };
  } catch {
    return { ...DEFAULT_PANELS };
  }
}

function persistPanels(panels: PanelVisibility): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(panels));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/**
 * One-time onboarding hints / coachmarks (B7) — and the first-run wizard's
 * "onboarded" marker (B6) live in the same map. Account-wide, persisted to
 * localStorage (mirrors panels/view) so a coachmark fires once and never again.
 * A hint id is set true when the user dismisses or auto-sees it.
 */
const HINTS_STORAGE_KEY = "uniqus.hints";
function readStoredHints(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HINTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function persistHints(hints: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(hints));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/**
 * Which surface the workspace shows. "builder" (default) is the beginner-facing
 * Chat + big-live-Preview reframe; "code" reveals the full IDE (file tree, code
 * editor, logs). Like panel visibility, it's an account-wide layout preference
 * persisted to localStorage and deliberately NOT reset per project, so a user's
 * Builder/Code choice survives reloads and project switches.
 */
export type WorkspaceView = "builder" | "code";
const VIEW_STORAGE_KEY = "uniqus.view";
const DEFAULT_VIEW: WorkspaceView = "builder";

function readStoredView(): WorkspaceView {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "code" ? "code" : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

function persistView(view: WorkspaceView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** One streamed frame of a live agent interaction (P2 "Preview (Agent)"). */
export interface AgentPreviewFrame {
  seq: number;
  label: string;
  ok: boolean;
  detail?: string;
  url: string;
  /** base64-encoded image (no `data:` prefix). */
  image: string;
  mime: string;
  title?: string;
}

/** Live "Preview (Agent)" state — the agent driving the running app, frame by frame. */
export interface AgentPreviewState {
  /** call_id (or "flow:<id>") tying the current run's frames together. */
  callId: string | null;
  /** Set when the current run is a saved-flow replay, for the caption. */
  flowName: string | null;
  frames: AgentPreviewFrame[];
  /** True while a run is streaming; cleared on the final `done` frame. */
  active: boolean;
  /** True when new frames arrived but the user hasn't opened the tab yet. */
  unseen: boolean;
}

/**
 * Live status of one background sub-agent (the Activity Monitor's sub-agent
 * widget), fed by `subagent_update` WS events and keyed by `id`. Run-scoped:
 * cleared when a new turn starts; the final state of the last turn's sub-agents
 * stays visible until then.
 */
export interface SubAgentLive {
  id: string;
  index: number;
  type: string;
  label: string;
  task: string;
  model: string;
  status: "running" | "done" | "error";
  lastAction?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  error?: string;
}

interface State {
  connected: boolean;
  /**
   * True once the WS client has exhausted its reconnect budget
   * (MAX_RECONNECT_ATTEMPTS) and given up auto-reconnecting. The UI surfaces a
   * "connection lost — Retry" affordance; a manual retry resets this to false.
   */
  connectionFailed: boolean;
  busy: boolean;
  /**
   * Set while the agent is running a dependency install (A4). Drives the
   * prominent "Installing dependencies — don't refresh" banner above the
   * composer and (with `busy`) the beforeunload guard. `command` captions it.
   */
  installInProgress: { command: string } | null;
  /**
   * Set on reconnect when the server reports a run is still alive (A1/A2). Drives
   * a "your build kept running" banner; cleared when the turn completes.
   */
  runReattaching: boolean;
  /**
   * One-time onboarding hints/coachmarks the user has seen (B7) + the wizard's
   * "onboarded" marker (B6). Persisted to localStorage.
   */
  seenHints: Record<string, boolean>;
  /**
   * Coarse plan-vs-execute flag, kept in LOCKSTEP with `permissionMode` (plan →
   * plan-then-execute, everything else → execute-only). Retained for the landing
   * surfaces (LandingPrompt / ProjectPicker) that only toggle plan on/off; the
   * Workspace composer drives the richer `permissionMode` instead.
   */
  mode: "plan-then-execute" | "execute-only";
  /**
   * Whether the user has explicitly chosen a plan/execute mode this session
   * (via the Plan toggle). Auto-defaults — e.g. "plan mode on for the first
   * turn of a brand-new project" — only apply when this is false, so we never
   * override a deliberate choice. Reset per project in `reset()`.
   */
  modeTouched: boolean;
  /**
   * The permission mode for the next (or in-flight) turn — the composer's mode
   * dropdown. Source of truth; `mode` above is derived from it. Plan is forced
   * on a brand-new project's first turn; otherwise it falls back to
   * acceptEdits. Changing it mid-turn sends `set_permission_mode` live.
   */
  permissionMode: PermissionMode;
  /** Like `modeTouched`, but for the richer permission dropdown. */
  permissionModeTouched: boolean;
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
  /**
   * Reasoning effort for the agent (account-wide default, localStorage-backed).
   * Sent with each turn; the orchestrator maps it to the provider's native
   * reasoning control. Edited from the composer's thinking picker.
   */
  thinking: ThinkingEffort;
  /**
   * Whether extended thinking is enabled (the composer's on/off toggle). Sent
   * with each turn as `thinking_enabled`; when false the orchestrator disables
   * reasoning for a faster turn. Persisted account-wide, default on.
   */
  thinkingEnabled: boolean;
  /**
   * Active dashboard workspace (P3.1): null = Personal, else an org id.
   * Account-wide, localStorage-backed; read by the ProjectPicker to scope its
   * project list + new-project creation.
   */
  activeWorkspaceId: string | null;
  chat: ChatItem[];
  tree: TreeEntry[];
  /**
   * False until the first `tree_listing` lands after connect, so the file
   * explorer can show a loading skeleton instead of a misleading "No files
   * yet." during the connect window (UI/UX audit §B).
   */
  treeLoaded: boolean;
  selectedFile: string | null;
  fileContent: string;
  terminalLines: TerminalLine[];
  /** Count of log lines dropped past the ring-buffer cap, for a "trimmed" note. */
  terminalDropped: number;
  pendingPlanItemId: string | null;
  previews: PreviewServer[];
  /**
   * Files the user has opened as tabs in the editor area. Independent from
   * selectedFile — `selectedFile` is the most recently focused file (used to
   * load content); `openFiles` is the tab strip.
   */
  openFiles: string[];
  /** Active tab id in the editor area: "file:<path>", "preview:<id>", or "agent-preview". */
  editorTab: string;
  /** P2 live "Preview (Agent)" view — frames stream in as the agent drives the app. */
  agentPreview: AgentPreviewState;
  panels: PanelVisibility;
  /**
   * Which workspace surface is shown: "builder" (Chat + big live Preview, the
   * beginner default) or "code" (the full IDE). Account-wide, localStorage-
   * backed, and never reset per project (see `reset()`).
   */
  view: WorkspaceView;
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
  /**
   * Live background sub-agents for the in-flight turn (the Activity Monitor's
   * sub-agent widget), keyed by id and ordered by spawn index. Updated from
   * `subagent_update` WS events; cleared when a new turn starts.
   */
  subagents: SubAgentLive[];
  /**
   * Live cumulative token usage for the in-flight turn (Plan §5), updated from
   * `usage` WS events. Null when no turn is running. The composer shows it as a
   * running "X in · Y out" counter; cleared when the turn completes. `input` is
   * FRESH (uncached) input; cached reads/writes are tracked separately so the
   * Activity Monitor can show the split and price the live spend via `model`.
   */
  liveUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    model?: string;
  } | null;
  /**
   * Element the user picked from the preview (element picker), waiting to be
   * attached to the next turn. Set by PreviewPanel, rendered as a chip and sent
   * as `selected_element` by ChatPanel, then cleared on a successful send.
   */
  pendingSelectedElement: SelectedElement | null;
  /**
   * Files queued from outside the composer — e.g. an annotated preview
   * screenshot from the PreviewAnnotator. ChatPanel drains these into its own
   * pending-attachments list so the existing upload→image path handles them;
   * this is just the hand-off channel between the preview pane and the chat
   * composer (sibling components).
   */
  queuedComposerFiles: File[];

  /**
   * Files attached in the landing-page composer before a project existed. Set
   * just before navigating into a freshly-created workspace; ChatPanel drains
   * them into its pending attachments once the project loads. Deliberately NOT
   * cleared by `reset()` (which runs on workspace mount) so the hand-off
   * survives that reset and the project switch.
   */
  briefFiles: File[];

  /**
   * One-shot text to drop into the chat composer from outside it — e.g. the
   * "Reject & revise" plan action seeds a revision prompt (UI/UX audit §C).
   * ChatPanel adopts it into its local input and clears it.
   */
  pendingComposerText: string | null;

  setConnected(c: boolean): void;
  setConnectionFailed(failed: boolean): void;
  setBusy(b: boolean): void;
  setInstallInProgress(v: { command: string } | null): void;
  setRunReattaching(v: boolean): void;
  /** Mark a one-time hint/coachmark (or the wizard) as seen (B6/B7). */
  markHintSeen(id: string): void;
  /** Set mode programmatically (auto-defaults). Does NOT mark modeTouched. */
  setMode(m: "plan-then-execute" | "execute-only"): void;
  /** Set mode from a user action (the Plan toggle). Marks modeTouched. */
  setModeManual(m: "plan-then-execute" | "execute-only"): void;
  /** Set the permission mode programmatically (defaults / server echo). Does NOT mark touched. */
  setPermissionMode(m: PermissionMode): void;
  /** Set the permission mode from a user action (the dropdown). Marks touched. */
  setPermissionModeManual(m: PermissionMode): void;
  /** Set the agent model choice and persist it as the account-wide default. */
  setModel(m: ModelChoice): void;
  /** Set the UI theme; persists + applies to <html data-theme>. */
  setTheme(t: ThemeChoice): void;
  /** Set the UI density; persists + applies to <html data-density>. */
  setDensity(d: DensityChoice): void;
  /** Set the agent reasoning effort and persist it as the account-wide default. */
  setThinking(t: ThinkingEffort): void;
  /** Toggle extended thinking on/off; persists account-wide. */
  setThinkingEnabled(enabled: boolean): void;
  /** Switch the active dashboard workspace (null = Personal); persists account-wide. */
  setActiveWorkspace(id: string | null): void;
  addUserMessage(
    content: string,
    attachments?: UploadedFileSummary[],
    fileRefs?: string[],
    selectedElement?: SelectedElement,
    at?: number,
  ): void;
  /**
   * Remove the most recent user-role chat bubble (the echoed user message).
   * No-ops if the list is empty or the last item isn't a user message — used
   * to roll back the echo when the send fails (B-2).
   */
  removeLastUserMessage(): void;
  appendText(content: string): void;
  /** Append a reasoning/thinking delta to the current reasoning block. */
  appendThinking(content: string): void;
  addToolCall(callId: string, name: string, input: unknown): void;
  setToolResult(
    callId: string,
    result: string,
    isError: boolean,
    stats?: { lines_added?: number; lines_removed?: number },
    imagePaths?: string[],
  ): void;
  addUserQuestion(
    callId: string,
    question: string,
    options: string[] | undefined,
    allowFreeText: boolean,
  ): void;
  resolveUserQuestion(callId: string, answer: string): void;
  /** Add a tool-approval card (the agent paused on a gated tool call). */
  addToolApproval(info: {
    callId: string;
    tool: string;
    category: ToolRiskCategory;
    summary: string;
    reason: string;
    input: unknown;
  }): void;
  /** Freeze a tool-approval card with the user's verdict. */
  resolveToolApproval(callId: string, decision: "approve" | "approve_always" | "deny"): void;
  /**
   * Auto-resolve a still-pending approval card whose tool result just arrived
   * (the user switched to a permissive mode and the server auto-approved it), so
   * the card doesn't keep live buttons after the action already ran. No-op if the
   * card was already answered or doesn't exist.
   */
  autoResolveToolApproval(callId: string): void;
  addPlanProposal(plan: Plan): void;
  approvePendingPlan(plan: Plan): void;
  /** Mark the pending plan rejected (user chose "Reject & revise"). */
  rejectPendingPlan(): void;
  /** Resolve a still-pending plan card when its run is aborted (C-27). */
  cancelPendingPlan(): void;
  addSystem(content: string): void;
  /** Add Auto's per-turn model pick chip (from the `model_selected` event). */
  addModelSelection(info: {
    provider: string;
    model: string;
    tier?: "quick" | "standard" | "hard";
    vision?: boolean;
  }): void;
  /** Add a run-level error card (C7). */
  addErrorItem(message: string, code?: string, retryable?: boolean): void;
  addCompleteMarker(
    toolCalls: number,
    elapsedMs: number,
    aborted: boolean,
    inputTokens?: number,
    outputTokens?: number,
    extra?: {
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
      model?: string;
      cost_usd?: number;
      changed_files?: ChangedFile[];
      suggestions?: string[];
      subagent_count?: number;
      subagent_input_tokens?: number;
      subagent_output_tokens?: number;
      subagent_cost_usd?: number;
    },
  ): void;
  setLiveUsage(
    usage: { input: number; output: number; cacheRead: number; cacheCreation: number; model?: string } | null,
  ): void;
  /** Upsert one background sub-agent's live status (from `subagent_update`). */
  upsertSubAgent(s: SubAgentLive): void;
  /** Clear all sub-agents (a new turn starts). */
  clearSubAgents(): void;
  /** Set (or clear) the element picked from the preview for the next turn. */
  setPendingSelectedElement(el: SelectedElement | null): void;
  /** Append files (e.g. an annotated screenshot) for the composer to pick up. */
  enqueueComposerFiles(files: File[]): void;
  /**
   * Remove exactly the files ChatPanel drained (by reference identity), leaving
   * any enqueued between the drain-read and this call — so a file queued in
   * that window isn't lost (B-29).
   */
  clearQueuedComposerFiles(drained: File[]): void;
  /** Stage text for the composer to adopt (one-shot). */
  setPendingComposerText(text: string | null): void;
  /** Stage landing-page attachments for the workspace composer to adopt. */
  setBriefFiles(files: File[]): void;
  /** Empty the brief-files hand-off (ChatPanel calls after draining). */
  clearBriefFiles(): void;
  setTree(entries: TreeEntry[]): void;
  setFile(path: string | null, content: string): void;
  appendTerminalLine(text: string, stream?: TerminalLine["stream"]): void;
  /** Empty the Logs pane (user-invoked Clear). */
  clearTerminal(): void;
  addPreview(p: PreviewServer): void;
  removePreview(id: string): void;
  openFile(path: string): void;
  closeOpenFile(path: string): void;
  setEditorTab(tab: string): void;
  /** Append a streamed interaction frame (from an `agent_preview_frame` event). */
  addAgentPreviewFrame(frame: {
    call_id: string;
    seq: number;
    label: string;
    ok: boolean;
    detail?: string;
    url: string;
    image: string;
    mime: string;
    title?: string;
    done?: boolean;
    flow_name?: string;
  }): void;
  /** Reset the live view (e.g. when leaving a project). */
  clearAgentPreview(): void;
  /** Clear the "new frames" badge once the user opens the Preview (Agent) tab. */
  markAgentPreviewSeen(): void;
  togglePanel(name: keyof PanelVisibility): void;
  setPanel(name: keyof PanelVisibility, value: boolean): void;
  /** Restore default panel visibility (used by "Reset layout"). */
  resetPanels(): void;
  /** Switch the workspace surface (Builder ⇄ Code); persists account-wide. */
  setView(v: WorkspaceView): void;
  setUser(u: CurrentUser | null): void;
  setProject(p: ProjectSummary | null): void;
  setLastSyncedAt(at: number): void;
  setSaveStatus(path: string, status: SaveStatus): void;
  setPendingEdit(path: string, content: string): void;
  clearPendingEdit(path: string): void;
  toggleTurn(completeItemId: string): void;
  setDeployment(d: DeploymentLive | null): void;
  setRedeploySuggested(value: boolean): void;
  /**
   * Signal that project files changed (a `file_changed` WS event). Drives the
   * redeploy nudge: if the live deploy is already READY, the deployed app is
   * now stale, so suggest a redeploy. A no-op otherwise (nothing deployed yet,
   * or a deploy is already in flight).
   */
  markProjectFilesChanged(): void;
  setTodos(items: TodoItem[]): void;
  resetChat(): void;
  reset(): void;
}

/** Merge a sub-agent update into the list, keyed by id, ordered by spawn index. */
function upsertSubAgentList(list: SubAgentLive[], s: SubAgentLive): SubAgentLive[] {
  const idx = list.findIndex((x) => x.id === s.id);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = s;
    return next;
  }
  return [...list, s].sort((a, b) => a.index - b.index);
}

let nextId = 1;
const id = () => `i${nextId++}`;
// Rewind the block-id counter so a fresh session (resetChat/reset) starts ids
// clean. Without this, replayed blocks on session_started reuse ids from a
// prior/live stream and appendText/appendThinking merge deltas into the wrong
// block (B-27).
const resetIds = () => {
  nextId = 1;
};

export const fileTabId = (path: string): string => `file:${path}`;
export const previewTabId = (serverId: string): string => `preview:${serverId}`;
/** Fixed id for the single live "Preview (Agent)" tab (P2). */
export const AGENT_PREVIEW_TAB = "agent-preview";

const emptyAgentPreview = (): AgentPreviewState => ({
  callId: null,
  flowName: null,
  frames: [],
  active: false,
  unseen: false,
});

export const useStore = create<State>((set, get) => ({
  connected: false,
  connectionFailed: false,
  busy: false,
  installInProgress: null,
  runReattaching: false,
  seenHints: readStoredHints(),
  mode: "execute-only",
  modeTouched: false,
  permissionMode: DEFAULT_PERMISSION_MODE,
  permissionModeTouched: false,
  model: readStoredModel(),
  // SSR-safe defaults: the persisted choice is applied to <html> before paint
  // by the layout bootstrap script, and hydrated into the store on mount via
  // hydrateAppearanceFromStorage() — initializing from localStorage here would
  // desync the first client render from the server HTML.
  theme: "dark",
  density: "comfortable",
  thinking: readStoredThinking(),
  thinkingEnabled: readStoredThinkingEnabled(),
  activeWorkspaceId: readStoredWorkspace(),
  chat: [],
  tree: [],
  treeLoaded: false,
  selectedFile: null,
  fileContent: "",
  terminalLines: [],
  terminalDropped: 0,
  pendingPlanItemId: null,
  previews: [],
  openFiles: [],
  editorTab: "",
  agentPreview: emptyAgentPreview(),
  // Files panel defaults ON: a builder shell with no visible file tree on
  // first paint feels empty even when the project has hundreds of files.
  // Terminal stays opt-in (it's currently a log viewer, not a real shell).
  // Persisted account-wide so a user's open/closed choice survives reloads.
  panels: readStoredPanels(),
  // Beginner-facing Builder view (Chat + live Preview) is the default; the
  // full IDE is one toggle away. Persisted account-wide like `panels`.
  view: readStoredView(),
  user: null,
  project: null,
  lastSyncedAt: null,
  saveStatus: {},
  pendingEdits: {},
  expandedTurns: {},
  deployment: null,
  redeploySuggested: false,
  todos: [],
  subagents: [],
  liveUsage: null,
  pendingSelectedElement: null,
  queuedComposerFiles: [],
  briefFiles: [],
  pendingComposerText: null,

  setConnected: (c) => set({ connected: c }),
  setConnectionFailed: (failed) => set({ connectionFailed: failed }),
  setBusy: (b) => set({ busy: b }),
  setInstallInProgress: (v) => set({ installInProgress: v }),
  setRunReattaching: (v) => set({ runReattaching: v }),
  markHintSeen: (id) =>
    set((s) => {
      if (s.seenHints[id]) return {};
      const next = { ...s.seenHints, [id]: true };
      persistHints(next);
      return { seenHints: next };
    }),
  // Legacy plan-toggle setters (LandingPrompt / ProjectPicker). Kept in lockstep
  // with permissionMode: turning plan ON ⇒ "plan"; turning it OFF ⇒ keep an
  // already-chosen rich mode, else fall to the default. Never silently downgrade
  // a bypass/default choice just because the binary toggle flicked off.
  setMode: (m) =>
    set((s) => ({
      mode: m,
      permissionMode:
        m === "plan-then-execute"
          ? "plan"
          : s.permissionMode === "plan"
            ? DEFAULT_PERMISSION_MODE
            : s.permissionMode,
    })),
  setModeManual: (m) =>
    set((s) => ({
      mode: m,
      modeTouched: true,
      permissionModeTouched: true,
      permissionMode:
        m === "plan-then-execute"
          ? "plan"
          : s.permissionMode === "plan"
            ? DEFAULT_PERMISSION_MODE
            : s.permissionMode,
    })),
  setPermissionMode: (m) => set({ permissionMode: m, mode: runModeForPermission(m) }),
  setPermissionModeManual: (m) =>
    set({
      permissionMode: m,
      permissionModeTouched: true,
      mode: runModeForPermission(m),
      modeTouched: true,
    }),
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
  setThinking: (t) => {
    persistThinking(t);
    set({ thinking: t });
  },
  setThinkingEnabled: (enabled) => {
    persistThinkingEnabled(enabled);
    set({ thinkingEnabled: enabled });
  },
  setActiveWorkspace: (id) => {
    persistWorkspace(id);
    set({ activeWorkspaceId: id });
  },

  addUserMessage: (content, attachments, fileRefs, selectedElement, at) =>
    set((s) => ({
      chat: [
        ...s.chat,
        {
          kind: "user",
          id: id(),
          content,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
          fileRefs: fileRefs && fileRefs.length > 0 ? fileRefs : undefined,
          selectedElement: selectedElement ?? undefined,
          at,
        },
      ],
    })),

  removeLastUserMessage: () =>
    set((s) => {
      const last = s.chat[s.chat.length - 1];
      // Only strip the echoed bubble if it's actually a user message — guards
      // against clobbering a real assistant/tool item (B-2).
      if (!last || last.kind !== "user") return {};
      return { chat: s.chat.slice(0, -1) };
    }),

  appendText: (content) =>
    set((s) => {
      const last = s.chat[s.chat.length - 1];
      if (last && last.kind === "assistant_text") {
        return {
          chat: [...s.chat.slice(0, -1), { ...last, content: last.content + content }],
        };
      }
      // Reasoning models (GLM-5.2 especially) can re-enter thinking MID-answer:
      // text → reasoning → text. Naively the trailing reasoning block makes the
      // resumed text open a SECOND assistant_text bubble, splitting one reply in
      // two — even mid-word ("…the two \"fail" | Thought | "ures\" are actually…").
      // If the only thing between us and the previous answer bubble is reasoning
      // block(s) — no tool call or other item, which ARE real turn boundaries —
      // continue that bubble so the answer stays one continuous block with the
      // interleaved thought kept alongside. On replay the provider coalesces all
      // content into a single block anyway, so this just matches the live stream
      // to the persisted form.
      let i = s.chat.length - 1;
      while (i >= 0 && s.chat[i].kind === "reasoning") i--;
      const target = i >= 0 ? s.chat[i] : undefined;
      if (target && target.kind === "assistant_text") {
        const merged = { ...target, content: target.content + content };
        return { chat: [...s.chat.slice(0, i), merged, ...s.chat.slice(i + 1)] };
      }
      return { chat: [...s.chat, { kind: "assistant_text", id: id(), content }] };
    }),

  appendThinking: (content) =>
    set((s) => {
      const last = s.chat[s.chat.length - 1];
      // Coalesce consecutive thinking deltas into one reasoning block. A new
      // block starts whenever anything else (text, a tool call) has landed
      // since — i.e. the model began a fresh reasoning pass for the next step.
      if (last && last.kind === "reasoning") {
        return {
          chat: [...s.chat.slice(0, -1), { ...last, content: last.content + content }],
        };
      }
      return { chat: [...s.chat, { kind: "reasoning", id: id(), content }] };
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

  setToolResult: (callId, result, isError, stats, imagePaths) => {
    set((s) => ({
      chat: s.chat.map((item) => {
        if (item.kind === "tool" && item.call_id === callId) {
          return {
            ...item,
            result,
            is_error: isError,
            lines_added: stats?.lines_added,
            lines_removed: stats?.lines_removed,
            imagePaths: imagePaths && imagePaths.length > 0 ? imagePaths : item.imagePaths,
          };
        }
        // The tool ran, so any still-open approval card for it is moot — freeze
        // it as approved (covers the auto-approve-on-mode-switch path, where the
        // user never clicked the card).
        if (
          item.kind === "tool_approval" &&
          item.call_id === callId &&
          item.decision === undefined
        ) {
          return { ...item, decision: "approve" as const };
        }
        return item;
      }),
    }));
    const item = get().chat.find((i) => i.kind === "tool" && i.call_id === callId);
    // Only mirror to the terminal for an actual run_command whose input has the
    // expected `{ command }` shape — guards the cast so a different tool landing
    // on the same callId can't be read through the wrong shape (B-30).
    if (
      item &&
      item.kind === "tool" &&
      item.name === "run_command" &&
      typeof item.input === "object" &&
      item.input &&
      "command" in item.input
    ) {
      get().appendTerminalLine(
        `$ ${(item.input as { command?: string }).command ?? ""}`,
        "cmd",
      );
      get().appendTerminalLine(result, isError ? "err" : "out");
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

  addToolApproval: (info) =>
    set((s) => {
      // Dedupe on call_id (defensive against a replayed/duplicated event).
      if (s.chat.some((i) => i.kind === "tool_approval" && i.call_id === info.callId)) {
        return {};
      }
      return {
        chat: [
          ...s.chat,
          {
            kind: "tool_approval",
            id: id(),
            call_id: info.callId,
            tool: info.tool,
            category: info.category,
            summary: info.summary,
            reason: info.reason,
            input: info.input,
          },
        ],
      };
    }),

  resolveToolApproval: (callId, decision) =>
    set((s) => ({
      chat: s.chat.map((item) =>
        item.kind === "tool_approval" && item.call_id === callId
          ? { ...item, decision }
          : item,
      ),
    })),

  autoResolveToolApproval: (callId) =>
    set((s) => ({
      chat: s.chat.map((item) =>
        item.kind === "tool_approval" && item.call_id === callId && item.decision === undefined
          ? { ...item, decision: "approve" as const }
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

  rejectPendingPlan: () =>
    set((s) => ({
      chat: s.chat.map((item) =>
        item.kind === "plan_proposal" && item.id === s.pendingPlanItemId
          ? { ...item, status: "rejected" }
          : item,
      ),
      pendingPlanItemId: null,
    })),

  // Resolve a still-pending plan card when its run is aborted (C-27). Otherwise
  // the card keeps its live Approve button, and since approvePendingPlan keys on
  // pendingPlanItemId (not the clicked card), clicking the stale card during a
  // LATER pending plan would resolve the NEW run's wait with the OLD plan.
  cancelPendingPlan: () =>
    set((s) => {
      if (!s.pendingPlanItemId) return {};
      return {
        chat: s.chat.map((item) =>
          item.kind === "plan_proposal" && item.id === s.pendingPlanItemId
            ? { ...item, status: "rejected" as const }
            : item,
        ),
        pendingPlanItemId: null,
      };
    }),

  addSystem: (content) =>
    set((s) => ({ chat: [...s.chat, { kind: "system", id: id(), content }] })),
  addModelSelection: (info) =>
    set((s) => ({ chat: [...s.chat, { kind: "routing", id: id(), ...info }] })),
  addErrorItem: (message, code, retryable) =>
    set((s) => ({ chat: [...s.chat, { kind: "error", id: id(), message, code, retryable }] })),

  addCompleteMarker: (toolCalls, elapsedMs, aborted, inputTokens, outputTokens, extra) =>
    set((s) => ({
      // Turn finished — drop the live counter; the final figure rides on the
      // complete marker below.
      liveUsage: null,
      chat: [
        ...s.chat,
        {
          kind: "complete",
          id: id(),
          tool_calls: toolCalls,
          elapsed_ms: elapsedMs,
          aborted,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: extra?.cache_read_tokens,
          cache_creation_tokens: extra?.cache_creation_tokens,
          model: extra?.model,
          cost_usd: extra?.cost_usd,
          subagent_count: extra?.subagent_count,
          subagent_input_tokens: extra?.subagent_input_tokens,
          subagent_output_tokens: extra?.subagent_output_tokens,
          subagent_cost_usd: extra?.subagent_cost_usd,
          changed_files: extra?.changed_files,
          suggestions: extra?.suggestions,
        },
      ],
    })),
  setLiveUsage: (usage) => set({ liveUsage: usage }),
  upsertSubAgent: (s) => set((st) => ({ subagents: upsertSubAgentList(st.subagents, s) })),
  clearSubAgents: () => set({ subagents: [] }),
  setPendingSelectedElement: (el) => set({ pendingSelectedElement: el }),
  enqueueComposerFiles: (files) =>
    set((s) => ({ queuedComposerFiles: [...s.queuedComposerFiles, ...files] })),
  clearQueuedComposerFiles: (drained) =>
    set((s) => {
      if (drained.length === 0 || s.queuedComposerFiles.length === 0) return {};
      // Drop only the drained files by reference identity, preserving anything
      // enqueued after the drain-read so it isn't lost (B-29).
      const remaining = s.queuedComposerFiles.filter((f) => !drained.includes(f));
      if (remaining.length === s.queuedComposerFiles.length) return {};
      return { queuedComposerFiles: remaining };
    }),
  setPendingComposerText: (text) => set({ pendingComposerText: text }),
  setBriefFiles: (files) => set({ briefFiles: files }),
  clearBriefFiles: () =>
    set((s) => (s.briefFiles.length === 0 ? {} : { briefFiles: [] })),

  setTree: (entries) => set({ tree: entries, treeLoaded: true }),
  setFile: (path, content) => set({ selectedFile: path, fileContent: content }),
  appendTerminalLine: (text, stream = "out") =>
    set((s) => {
      const overflow = s.terminalLines.length >= 500;
      return {
        terminalLines: [...s.terminalLines.slice(-499), { text, stream }],
        terminalDropped: overflow ? s.terminalDropped + 1 : s.terminalDropped,
      };
    }),
  clearTerminal: () => set({ terminalLines: [], terminalDropped: 0 }),

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
  setEditorTab: (tab) =>
    set((s) =>
      // Opening the agent tab also clears its "new frames" badge.
      tab === AGENT_PREVIEW_TAB && s.agentPreview.unseen
        ? { editorTab: tab, agentPreview: { ...s.agentPreview, unseen: false } }
        : { editorTab: tab },
    ),

  addAgentPreviewFrame: (frame) =>
    set((s) => {
      const cur = s.agentPreview;
      // A new run starts when the call_id changes, or a fresh seq-0 frame lands
      // after the previous run finished (each interact_preview / run_flow run
      // numbers its frames from 0). Within a run we append; the final `done`
      // frame just flips `active` off.
      const isNewRun = frame.call_id !== cur.callId || (frame.seq === 0 && !cur.active);
      const f: AgentPreviewFrame = {
        seq: frame.seq,
        label: frame.label,
        ok: frame.ok,
        detail: frame.detail,
        url: frame.url,
        image: frame.image,
        mime: frame.mime,
        title: frame.title,
      };
      const next = isNewRun ? [f] : [...cur.frames, f];
      // Cap retained frames so a long flow can't grow the store unbounded — keep
      // the most recent 60 (each frame is tens of KB of base64).
      const frames = next.length > 60 ? next.slice(next.length - 60) : next;
      const onTab = s.editorTab === AGENT_PREVIEW_TAB;
      // Surface the live "Preview (Agent)" tab via its activity badge, but do NOT
      // steal focus. A run used to auto-switch the editor onto the agent view like
      // a screen-share, yanking the user off whatever they were doing; now it only
      // flags "unseen" (the pulsing badge) unless they're already on the tab.
      return {
        agentPreview: {
          callId: frame.call_id,
          flowName: frame.flow_name ?? null,
          frames,
          active: !frame.done,
          unseen: onTab ? false : true,
        },
      };
    }),

  clearAgentPreview: () => set({ agentPreview: emptyAgentPreview() }),

  markAgentPreviewSeen: () =>
    set((s) =>
      s.agentPreview.unseen ? { agentPreview: { ...s.agentPreview, unseen: false } } : {},
    ),

  togglePanel: (name) =>
    set((s) => {
      const panels = { ...s.panels, [name]: !s.panels[name] };
      persistPanels(panels);
      return { panels };
    }),
  setPanel: (name, value) =>
    set((s) => {
      const panels = { ...s.panels, [name]: value };
      persistPanels(panels);
      return { panels };
    }),
  resetPanels: () => {
    const panels = { ...DEFAULT_PANELS };
    persistPanels(panels);
    set({ panels });
  },
  setView: (v) => {
    persistView(v);
    set({ view: v });
  },

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
  setDeployment: (d) =>
    set((s) => {
      // deploy_state_changed WS events carry no inspector_url (and the object is
      // fully replaced), so every state transition wiped the field set by the
      // initial deploy POST — killing the "View build logs" link exactly when an
      // ERROR state arrives (C-31/U-4). Carry inspector_url (and vercel_url if
      // the event omits it) forward when updating the SAME deployment.
      const prev = s.deployment;
      const merged =
        d !== null && prev !== null && prev.id === d.id
          ? {
              ...d,
              inspector_url: d.inspector_url ?? prev.inspector_url,
              vercel_url: d.vercel_url ?? prev.vercel_url,
            }
          : d;
      // A new deploy starting (QUEUED/BUILDING) or succeeding (READY) means the
      // live deploy now reflects the current files — clear the stale-files
      // nudge. A failed/canceled deploy leaves it as-is (files are still
      // un-deployed, so keep nudging if we already were).
      const clears =
        merged !== null &&
        (merged.state === "QUEUED" || merged.state === "BUILDING" || merged.state === "READY");
      return clears
        ? { deployment: merged, redeploySuggested: false }
        : { deployment: merged };
    }),
  setRedeploySuggested: (value) => set({ redeploySuggested: value }),
  markProjectFilesChanged: () =>
    set((s) =>
      // Only nudge once there's a live, READY deploy to fall out of date — a
      // file change before the first deploy (or while one is in flight) isn't
      // a "redeploy" situation.
      s.deployment?.state === "READY" ? { redeploySuggested: true } : {},
    ),
  setTodos: (items) => set({ todos: items }),
  resetChat: () => {
    // Rewind block ids before clearing so replayed blocks can't collide with a
    // prior/live stream's ids (B-27).
    resetIds();
    set({
      chat: [],
      pendingPlanItemId: null,
      terminalLines: [],
      terminalDropped: 0,
      expandedTurns: {},
      redeploySuggested: false,
      liveUsage: null,
      subagents: [],
      pendingSelectedElement: null,
      queuedComposerFiles: [],
    });
  },
  reset: () => {
    // Rewind block ids on a per-project fresh start, same reason as resetChat
    // (B-27).
    resetIds();
    set({
      // Per-project fresh start so the first-turn plan default re-evaluates.
      mode: "execute-only",
      modeTouched: false,
      permissionMode: DEFAULT_PERMISSION_MODE,
      permissionModeTouched: false,
      chat: [],
      tree: [],
      // treeLoaded resets to false so the explorer shows its loading skeleton
      // until the new project's tree arrives, not a stale "No files yet."
      treeLoaded: false,
      selectedFile: null,
      fileContent: "",
      terminalLines: [],
      terminalDropped: 0,
      pendingPlanItemId: null,
      previews: [],
      openFiles: [],
      editorTab: "",
      agentPreview: emptyAgentPreview(),
      // panels + view intentionally omitted — both are account-wide layout prefs
      // persisted to localStorage; a project switch must not reset the user's
      // open/closed panel choice (UI/UX audit §B) or their Builder/Code view.
      user: null,
      project: null,
      lastSyncedAt: null,
      saveStatus: {},
      pendingEdits: {},
      expandedTurns: {},
      deployment: null,
      redeploySuggested: false,
      todos: [],
      subagents: [],
      liveUsage: null,
      pendingSelectedElement: null,
      queuedComposerFiles: [],
      // Clear run state on a project/session switch (C-28/C-30). The old project's
      // run streamed against its own socket; carrying busy=true into a fresh,
      // empty session (which replays no `complete` and emits no `run_active`)
      // left the composer disabled with "Uniqus is running…" forever, recoverable
      // only via the obscure force-stop. installInProgress/runReattaching are the
      // same kind of stale run state.
      busy: false,
      installInProgress: null,
      runReattaching: false,
    });
  },
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
  const { pendingEdits, busy, connected, setSaveStatus } =
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
  // Do NOT clear the pending edit here — wait for client_write_ack (C-29). The
  // ack handler clears it on ok:true (and only if no newer keystroke re-dirtied
  // the path); on ok:false the edit stays buffered so the Save retry button can
  // resend it. Clearing pre-ack lost the edit on any write failure.
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
