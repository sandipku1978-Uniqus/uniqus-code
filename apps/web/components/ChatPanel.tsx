"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClientEvent, UploadedFileSummary } from "@uniqus/api-types";
import { MODEL_CATALOG } from "@uniqus/api-types";
import {
  fetchSlashCommandsApi,
  getApiBase,
  uploadProjectFilesApi,
  type SlashCommandSummary,
} from "@/lib/api";
import { useStore, AGENT_PREVIEW_TAB, type ChatItem, type SelectedElement } from "@/lib/store";
import { useAutoGrowTextarea } from "@/lib/useAutoGrowTextarea";
import { useIsMobile } from "@/lib/use-is-mobile";
import { errorCopyFor } from "@/lib/errorCopy";
import { connect, send } from "@/lib/ws-client";
import PlanReview from "./PlanReview";
import ChatSessionDropdown from "./ChatSessionDropdown";
import ModelPicker from "./ModelPicker";
import PermissionModePicker from "./PermissionModePicker";
import MicButton from "./MicButton";
import Modal from "./Modal";
import TodoList from "./TodoList";
import SubAgentList from "./SubAgentList";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * A few short, realistic starter prompts shown on the empty-chat onboarding so
 * a first-time user isn't staring at a blank composer. Clicking one drops the
 * text into the composer (it doesn't auto-send) so they can tweak before
 * running. Kept local to this file — the picker has its own copy.
 */
const EXAMPLE_PROMPTS = [
  "Build an expense approval workflow where staff submit expenses and managers approve or reject them, with a status trail.",
  "Make a SOX control register: a table of controls with owner, test status, and an audit-ready evidence note.",
  "Create a budget vs. actuals dashboard by department with variance highlights and a month filter.",
];

/**
 * Whimsical "working" words cycled in the composer status strip while a turn
 * runs — mimics Claude Code's rotating gerunds. Kept on the professional side
 * of cute. A real server progress note (e.g. "Installing dependencies…")
 * overrides the cycling when one is present (see ChatPanel's inFlightProgress).
 */
const WORKING_WORDS = [
  "Working",
  "Thinking",
  "Cooking",
  "Crafting",
  "Brewing",
  "Pondering",
  "Computing",
  "Conjuring",
  "Tinkering",
  "Composing",
  "Noodling",
  "Synthesizing",
  "Assembling",
  "Percolating",
];

/**
 * The pinned "agent working" strip shown just above the composer: a small
 * Uniqus mark that eases through each spin (slow at the upright top, quick
 * through the bottom — see `.working-spinner` / `working-spin` in globals.css)
 * plus a status word. When `label` is null the whimsical words cycle every
 * ~2.4s; otherwise the (informative) server label is shown verbatim. Mounting
 * resets to the first word, so each new turn opens on "Working…".
 */
const WorkingStatus = memo(function WorkingStatus({
  label,
}: {
  label: string | null;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (label) return; // real progress shown — don't cycle over it
    const id = setInterval(
      () => setI((n) => (n + 1) % WORKING_WORDS.length),
      2400,
    );
    return () => clearInterval(id);
  }, [label]);
  const text = label ?? `${WORKING_WORDS[i]}…`;
  return (
    <div className="composer-working" role="status" aria-live="polite">
      <img
        className="working-spinner"
        src="/brand/uniqus-small-logo-color.png"
        alt=""
        aria-hidden="true"
        width={16}
        height={16}
      />
      {/* keyed on the text so each swap re-triggers the subtle fade-in */}
      <span className="composer-working-label" key={text}>
        {text}
      </span>
    </div>
  );
});

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const installInProgress = useStore((s) => s.installInProgress);
  const runReattaching = useStore((s) => s.runReattaching);
  const mode = useStore((s) => s.mode);
  const permissionMode = useStore((s) => s.permissionMode);
  const model = useStore((s) => s.model);
  const thinking = useStore((s) => s.thinking);
  const thinkingEnabled = useStore((s) => s.thinkingEnabled);
  const suggestionsEnabled = useStore((s) => s.suggestionsEnabled);
  const setSuggestionsEnabled = useStore((s) => s.setSuggestionsEnabled);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const addSystem = useStore((s) => s.addSystem);
  const setBusy = useStore((s) => s.setBusy);
  const clearSubAgents = useStore((s) => s.clearSubAgents);
  const project = useStore((s) => s.project);
  const connected = useStore((s) => s.connected);
  const connectionFailed = useStore((s) => s.connectionFailed);
  const expandedTurns = useStore((s) => s.expandedTurns);
  const toggleTurn = useStore((s) => s.toggleTurn);
  const liveUsage = useStore((s) => s.liveUsage);
  // Sub-agents spend their own tokens in the same turn; fold them into the live
  // "Usage so far" counter so it reflects the WHOLE turn's cost, not just the
  // lead agent's (item 3). Matches what the Activity Monitor already totals.
  const subagents = useStore((s) => s.subagents);
  const isMobile = useIsMobile();
  // Element the user picked from the preview (PreviewPanel sets this); attached
  // to the next turn as `selected_element` and cleared on a successful send.
  const pendingSelectedElement = useStore((s) => s.pendingSelectedElement);
  const setPendingSelectedElement = useStore((s) => s.setPendingSelectedElement);
  // Files handed over from the preview pane (e.g. an annotated screenshot) —
  // drained into pendingFiles below so the normal upload path handles them.
  const queuedComposerFiles = useStore((s) => s.queuedComposerFiles);
  const clearQueuedComposerFiles = useStore((s) => s.clearQueuedComposerFiles);
  // Attachments staged in the landing-page composer before this project
  // existed. Unlike queuedComposerFiles, briefFiles survives the per-project
  // reset() that runs on workspace mount, so it drains reliably below.
  const briefFiles = useStore((s) => s.briefFiles);
  const clearBriefFiles = useStore((s) => s.clearBriefFiles);
  // One-shot text injected from outside the composer (e.g. "Reject & revise").
  const pendingComposerText = useStore((s) => s.pendingComposerText);
  const setPendingComposerText = useStore((s) => s.setPendingComposerText);
  // Mirror Workspace's session-param read so a manual Retry reconnects to the
  // SAME chat session (a bare connect() would default the session to null and
  // silently drop the user back to the project's default thread).
  const searchParams = useSearchParams();
  const sessionParam = searchParams?.get("session") ?? null;
  const [input, setInput] = useState("");
  // Persist the composer draft per-project so a reload or a client-side crash
  // doesn't lose typed-but-unsent text. Cleared on successful send.
  const draftKey = project ? `uniqus.draft.${project.id}` : null;
  // The key the current `input` value belongs to. Set synchronously when we
  // (re)hydrate for a new key so the persist effect can never write one
  // project's text under another project's key during a switch.
  const draftKeyRef = useRef<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandSummary[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  // True from the moment the user clicks Stop until the server's `complete`
  // event lands. Without this, a click that the server is slow to act on
  // looks like a no-op — the button just keeps saying "Stop" until something
  // happens. Reset whenever `busy` flips (i.e. a turn ends or a new one starts).
  const [stopping, setStopping] = useState(false);
  // Drives the Modal-based "Clear chat history?" confirmation (replaces the
  // native window.confirm so it matches the app's other destructive dialogs).
  const [confirmReset, setConfirmReset] = useState(false);
  // The composer "+" add-menu (item 9): replaces the bare Files button with a
  // small popup so more actions can live under one affordance.
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  // Escalation for a Stop that the server is slow to honour: after a timeout we
  // offer a local "Force stop" so the kill switch never dead-ends (§C).
  const [forceStop, setForceStop] = useState(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cursor position in the composer, tracked so @file autocomplete works at the
  // caret (not only end-of-string) and Escape can dismiss the palettes (§C).
  const [cursor, setCursor] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-follow state (C-24). atBottomRef is updated by onScroll BEFORE new
  // content reflows, so a single update taller than the old slack (a streaming
  // flush, a tool card, a history burst) can't make a bottom-parked reader look
  // "scrolled up" and silently kill follow — the bug from measuring post-reflow.
  const atBottomRef = useRef(true);
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    setStopping(false);
    setForceStop(false);
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, [busy]);

  // Drain files queued from the preview pane (annotated screenshots) into the
  // composer's pending attachments, deduping the same way addFiles does, then
  // empty the hand-off queue so they aren't re-added on the next render.
  useEffect(() => {
    if (queuedComposerFiles.length === 0) return;
    // Snapshot exactly the files we drain so the store clears only these by
    // reference — anything enqueued between this read and the clear survives
    // (a blanket clear would drop files queued during that gap).
    const drained = queuedComposerFiles;
    setPendingFiles((current) => {
      const next = [...current];
      for (const file of drained) {
        const duplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        );
        if (!duplicate) next.push(file);
      }
      return next;
    });
    clearQueuedComposerFiles(drained);
  }, [queuedComposerFiles, clearQueuedComposerFiles]);

  // Adopt attachments staged by the landing-page composer, once the project is
  // loaded. Same dedupe rule as addFiles; cleared after draining so they aren't
  // re-added on a later render or carried into a different project.
  useEffect(() => {
    if (!project || briefFiles.length === 0) return;
    setPendingFiles((current) => {
      const next = [...current];
      for (const file of briefFiles) {
        const duplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        );
        if (!duplicate) next.push(file);
      }
      return next;
    });
    clearBriefFiles();
  }, [project, briefFiles, clearBriefFiles]);

  // Adopt one-shot text staged from outside the composer (plan "Reject &
  // revise" seeds a revision prompt; the preview error panel stages a fix
  // request). APPENDS to a non-empty draft rather than clobbering it — losing
  // half-typed text the user can't get back is worse than a slightly long
  // composer — then focuses so they can finish and send.
  useEffect(() => {
    if (pendingComposerText == null) return;
    const incoming = pendingComposerText;
    setInput((prev) => (prev.trim().length > 0 ? `${prev.trimEnd()}\n\n${incoming}` : incoming));
    setPendingComposerText(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const end = ta.value.length;
        ta.setSelectionRange(end, end);
      }
    });
  }, [pendingComposerText, setPendingComposerText]);

  // Lazy-load slash commands once per project. The list is small and stable
  // — built-ins never change at runtime, project commands change rarely.
  useEffect(() => {
    if (!project) return;
    let abort = false;
    fetchSlashCommandsApi(project.id)
      .then((r) => {
        if (!abort) setSlashCommands(r.commands);
      })
      .catch(() => {});
    return () => {
      abort = true;
    };
  }, [project]);

  // The composer grows with its content up to ~10 lines (less on a short
  // screen), then scrolls — same expanding behavior as the landing-hero box.
  useAutoGrowTextarea(textareaRef, input);

  // Hydrate whenever the key changes (first load OR a project switch). Always
  // replaces `input` with the new key's saved value (or "") so stale text from
  // the previous project can't linger — and marks which key `input` now holds.
  useEffect(() => {
    if (!draftKey) return;
    let saved = "";
    try {
      saved = localStorage.getItem(draftKey) ?? "";
    } catch {
      // localStorage can throw in private mode / when disabled — drafts are a
      // nicety, never block the composer over it.
    }
    draftKeyRef.current = draftKey;
    setInput(saved);
  }, [draftKey]);

  // Persist on input change only — NOT on draftKey change. This runs after the
  // hydrate effect above has settled `input` for the current key, so it always
  // writes under the key `input` actually belongs to (draftKeyRef), never the
  // previous project's leftover text under the new key.
  useEffect(() => {
    const key = draftKeyRef.current;
    if (!key) return;
    try {
      if (input) localStorage.setItem(key, input);
      else localStorage.removeItem(key);
    } catch {
      /* ignore — see note above */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Clipboard paste for images/files
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        addFiles(dt.files);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Show palette when input begins with "/" and is one token wide
  // ("/review" matches; "/review now" doesn't).
  const slashFilter = useMemo(() => {
    const m = input.match(/^\/([a-zA-Z0-9_-]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [input]);
  const slashMatches = useMemo(() => {
    if (slashFilter === null || paletteDismissed) return [];
    return slashCommands.filter((c) => c.name.startsWith(slashFilter)).slice(0, 6);
  }, [slashFilter, slashCommands, paletteDismissed]);
  useEffect(() => {
    setSlashIndex(0);
  }, [slashFilter]);
  // A new filter token means the user kept typing — undo any prior Escape so the
  // palette can re-appear.
  useEffect(() => {
    setPaletteDismissed(false);
  }, [slashFilter]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Session/project switch clears chat — re-arm the initial jump so the next
    // session's replayed history lands at the bottom, not wherever this one was.
    if (chat.length === 0) {
      didInitialScrollRef.current = false;
      atBottomRef.current = true;
      return;
    }
    // First paint (a reopened session replays its whole history at once): jump
    // straight to the latest message instead of stranding the view at the top.
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight });
      atBottomRef.current = true;
      return;
    }
    // Follow new content only if the user was parked at the bottom BEFORE this
    // update (captured by onScroll), not by re-measuring after the new rows have
    // already grown scrollHeight — that post-reflow measure killed follow on any
    // single update taller than the 100px slack (C-24).
    if (!atBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat]);

  // Track bottom-parked state on every scroll, so the follow effect above reads
  // the user's intent as of BEFORE the new content arrived.
  const onChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  const turns = useMemo(() => buildTurns(chat), [chat]);

  // Label for the composer "working" strip: the most recent server `system`
  // progress note of the in-flight turn (e.g. "Starting sandbox…", "Installing
  // dependencies…"), surfaced ONLY before any real output has streamed. Once
  // assistant text / tool cards land, that note is stale, so we return null and
  // the strip falls back to its cycling whimsical words. (Mirrors the guard the
  // old in-stream thinking pill used.)
  const inFlightProgress = useMemo<string | null>(() => {
    const last = turns[turns.length - 1];
    if (!last || last.complete) return null;
    if (last.body.some((i) => i.kind !== "system")) return null;
    const sys = [...last.body].reverse().find((i) => i.kind === "system");
    return sys && sys.kind === "system" ? sys.content : null;
  }, [turns]);

  // GRIPE 10 — single ghost-text follow-up suggestion (replaces the old
  // follow-up chips). The first suggestion of the most-recently completed turn
  // is offered as dimmed text overlaid on the empty composer; Tab (or a click)
  // accepts it into the input without sending. Keyed by the complete-marker id
  // so a manual dismiss sticks to that turn but a NEW turn re-offers a fresh
  // hint. Cleared automatically whenever the input is non-empty.
  const latestComplete = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const c = turns[i].complete;
      if (c) return c;
    }
    return null;
  }, [turns]);
  const [ghostDismissedId, setGhostDismissedId] = useState<string | null>(null);
  const ghostSuggestion: string | null =
    suggestionsEnabled &&
    latestComplete &&
    latestComplete.id !== ghostDismissedId &&
    !busy &&
    !uploading &&
    connected &&
    !!project &&
    input.length === 0
      ? (latestComplete.suggestions?.[0]?.trim() || null)
      : null;
  // Fill the suggestion into the composer (Tab / click). Does NOT send — the
  // user reviews and presses Enter themselves. Dismisses the hint for this turn.
  const acceptGhostSuggestion = useCallback(() => {
    if (!ghostSuggestion) return;
    setInput(ghostSuggestion);
    setGhostDismissedId(latestComplete?.id ?? null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const end = ta.value.length;
        ta.setSelectionRange(end, end);
      }
    });
  }, [ghostSuggestion, latestComplete]);

  // Bound the rendered conversation for very long sessions (A3 item 4). The
  // per-row/per-turn memoization above is the real freeze cure; this caps the
  // initial mount + live DOM size so a many-hundred-turn history doesn't render
  // all at once. The in-flight turn is always in the tail slice, so streaming is
  // never affected.
  const TURN_WINDOW = 60;
  const [showAllTurns, setShowAllTurns] = useState(false);
  const hiddenTurnCount =
    !showAllTurns && turns.length > TURN_WINDOW ? turns.length - TURN_WINDOW : 0;
  const visibleTurns = hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns;

  // beforeunload guard (A4): warn before a refresh/close while the agent is
  // working or installing deps — the instinctive refresh is what loses the
  // not-yet-written tail of a run. (Once the run-registry lands the run also
  // survives the refresh, but the warning still spares users the scare.)
  useEffect(() => {
    if (!busy && !installInProgress) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy, installInProgress]);

  const tree = useStore((s) => s.tree);
  const validFilePaths = useMemo(() => {
    const set = new Set<string>();
    for (const entry of tree) {
      if (!entry.is_dir) set.add(entry.path);
    }
    return set;
  }, [tree]);

  // @file autocomplete — detect "@<partial>" immediately left of the caret, so
  // it fires mid-sentence ("see @com|ponents") and not only at end-of-string.
  const [atIndex, setAtIndex] = useState(0);
  const beforeCursor = useMemo(
    () => input.slice(0, Math.min(cursor, input.length)),
    [input, cursor],
  );
  const atFilter = useMemo(() => {
    const m = beforeCursor.match(/(?:^|\s)@([\w./-]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [beforeCursor]);
  const atMatches = useMemo(() => {
    if (atFilter === null || paletteDismissed) return [];
    const all = Array.from(validFilePaths);
    return all
      .filter((p) => p.toLowerCase().includes(atFilter))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(atFilter) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(atFilter) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      })
      .slice(0, 8);
  }, [atFilter, validFilePaths, paletteDismissed]);
  useEffect(() => {
    setAtIndex(0);
  }, [atFilter]);
  useEffect(() => {
    setPaletteDismissed(false);
  }, [atFilter]);

  // Replace the @-token immediately left of the caret with the picked path,
  // preserving any text after the caret (the old code only worked at EOS).
  const applyAtPick = useCallback(
    (path: string) => {
      const left = input.slice(0, Math.min(cursor, input.length));
      const right = input.slice(Math.min(cursor, input.length));
      const newLeft = left.replace(/@[\w./-]*$/, `@${path} `);
      const next = newLeft + right;
      setInput(next);
      const pos = newLeft.length;
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(pos, pos);
          setCursor(pos);
        }
      });
    },
    [input, cursor],
  );

  // Keep `cursor` in sync with the textarea caret.
  const syncCursor = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) setCursor(ta.selectionStart ?? 0);
  }, []);

  /**
   * Send a plain-text turn without going through the composer's upload path.
   * Shared by message Resend, the CompleteRow Regenerate control, and the tool
   * "Fix this" action so they all assemble the same payload and echo a bubble.
   * Returns true if it actually went out.
   */
  const sendText = useCallback(
    (content: string): boolean => {
      const trimmed = content.trim();
      if (!trimmed || busy || uploading || !project || !connected) return false;
      const fileRefs = extractFileRefs(trimmed, validFilePaths);
      const payload: ClientEvent = {
        type: "user_message",
        content: trimmed,
        mode,
        permission_mode: permissionMode,
        model: model !== "auto" ? model : undefined,
        thinking: thinking !== "medium" ? thinking : undefined,
        // Only send when OFF — omitted defaults to on server-side.
        thinking_enabled: thinkingEnabled ? undefined : false,
        file_refs: fileRefs.length > 0 ? fileRefs : undefined,
      };
      const ok = send(payload);
      if (!ok) {
        addSystem(
          "disconnected — message not sent. We'll reconnect automatically; try again in a moment.",
        );
        return false;
      }
      addUserMessage(trimmed, undefined, fileRefs, undefined, Date.now());
      // Fresh turn (sendText only runs when not busy) — clear the previous turn's
      // sub-agents so the Activity Monitor / mobile strip don't show stale rows.
      clearSubAgents();
      setBusy(true);
      return true;
    },
    [busy, uploading, project, connected, mode, permissionMode, model, thinking, thinkingEnabled, validFilePaths, addSystem, addUserMessage, clearSubAgents, setBusy],
  );

  // Load a previous user message back into the composer for editing.
  const handleEditMessage = useCallback((text: string) => {
    setInput(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // Re-send a previous user message verbatim (or regenerate a turn's answer).
  const handleResend = useCallback((text: string) => void sendText(text), [sendText]);

  // Retry the run after a failure (C7): resend the most recent user message.
  // Reads the live store so it isn't tied to a stale closure of `chat`.
  const handleRetryRun = useCallback(() => {
    const last = [...useStore.getState().chat].reverse().find((i) => i.kind === "user");
    if (last && last.kind === "user") void sendText(last.content);
  }, [sendText]);

  const chatHandlers = useMemo<ChatHandlers>(
    () => ({
      onEdit: handleEditMessage,
      onResend: handleResend,
      onRetryRun: handleRetryRun,
      canAct: connected && !busy,
    }),
    [handleEditMessage, handleResend, handleRetryRun, connected, busy],
  );

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    // Snapshot the picked element now — it's valid context even with no text.
    const selectedElement = pendingSelectedElement;
    // NOTE: `busy` is intentionally NOT a guard here. While a turn is running,
    // a send becomes a MID-TURN steering message — the server queues it for the
    // running main agent to pick up at its next step (see the orchestrator's
    // user_message handler). Stop stays available as the separate kill switch.
    if (
      (!trimmed && pendingFiles.length === 0 && !selectedElement) ||
      uploading ||
      !project ||
      !connected
    ) {
      return;
    }

    setUploading(true);
    let attachments: UploadedFileSummary[] = [];
    try {
      if (pendingFiles.length > 0) {
        const result = await uploadProjectFilesApi({
          projectId: project.id,
          files: pendingFiles,
        });
        attachments = result.files;
      }
    } catch (err) {
      addSystem(`upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setUploading(false);
      return;
    }

    // The upload await above could have spanned a disconnect. Re-check
    // connectivity before send() so we don't echo a bubble and clear the
    // composer against a closed socket. `busy` is NOT re-checked: a send while
    // busy is a deliberate steering message (see the guard above).
    if (!connected) {
      addSystem(
        "disconnected — message not sent. We'll reconnect automatically; try again in a moment.",
      );
      setUploading(false);
      return;
    }

    const content =
      trimmed ||
      (pendingFiles.length > 0 ? "Use the attached file(s)." : "Use the selected element.");
    const fileRefs = extractFileRefs(content, validFilePaths);
    // The `selected_element` block rides on the user_message. The shared
    // contract (C) puts it there; the orchestrator's ClientEvent type gains the
    // field in the paired Backend track, so until that lands we widen the
    // payload locally rather than editing the shared package from this track.
    const payload: ClientEvent & { selected_element?: SelectedElement } = {
      type: "user_message",
      content,
      mode,
      permission_mode: permissionMode,
      model: model !== "auto" ? model : undefined,
      thinking: thinking !== "medium" ? thinking : undefined,
      // Only send when OFF — omitted defaults to on server-side.
      thinking_enabled: thinkingEnabled ? undefined : false,
      attachments,
      file_refs: fileRefs.length > 0 ? fileRefs : undefined,
    };
    if (selectedElement) payload.selected_element = selectedElement;
    // Send is synchronous, so check the result BEFORE echoing/clearing. On a
    // closed socket we keep the composer text (and its saved draft) and don't
    // echo a bubble — otherwise the user would lose the exact text the draft
    // feature exists to protect, with a misleading "sent" bubble left behind.
    // The finally guarantees `uploading` is reset even if send()/echo throws,
    // so a failed send can never wedge the composer disabled.
    try {
      const ok = send(payload);
      if (!ok) {
        addSystem(
          "disconnected — message not sent. We'll reconnect automatically; try again in a moment.",
        );
        return;
      }
      // Sent — echo the message, mark the turn busy, and clear the composer +
      // its persisted draft (and the one-shot selected element).
      addUserMessage(content, attachments, fileRefs, selectedElement ?? undefined, Date.now());
      // Only a FRESH turn clears the previous turn's sub-agents. A send while
      // busy is steering for the running turn — keep its live sub-agents.
      if (!busy) clearSubAgents();
      setBusy(true);
      setInput("");
      setPendingFiles([]);
      if (selectedElement) setPendingSelectedElement(null);
    } finally {
      setUploading(false);
    }
  };

  const handleStop = () => {
    if (!busy) return;
    // Second click once the escalation kicked in: give up waiting on the server
    // and unwedge the UI locally so the kill switch never dead-ends (§C).
    if (forceStop) {
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      send({ type: "abort" });
      setBusy(false);
      setStopping(false);
      setForceStop(false);
      addSystem("Stopped. The agent may still be finishing its current step.");
      return;
    }
    setStopping(true);
    const ok = send({ type: "abort" });
    if (!ok) {
      // Socket dropped right when the user clicked Stop. Bail out locally so
      // the UI doesn't sit on "Stopping…" forever — when we reconnect, the
      // session will be in a fresh state anyway.
      setBusy(false);
      setStopping(false);
      addSystem("disconnected — stop request not sent.");
      return;
    }
    // If the server is slow to honour the abort, surface a local Force stop
    // after a grace period rather than sitting on "Stopping…" forever.
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => setForceStop(true), 9000);
  };

  const resetChat = () => {
    if (busy || chat.length === 0) return;
    setConfirmReset(true);
  };

  const confirmResetChat = () => {
    setConfirmReset(false);
    send({ type: "reset_session" });
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPendingFiles((current) => {
      const next = [...current];
      for (const file of Array.from(files)) {
        const duplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        );
        if (!duplicate) next.push(file);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_, i) => i !== index));
  };

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="label-micro">Chat</span>
        <div className="actions">
          {project && <ChatSessionDropdown projectId={project.id} />}
          <button
            onClick={resetChat}
            disabled={busy || chat.length === 0}
            className="icon-btn-sm"
            title="Clear chat history (sandbox files kept)"
            style={{ width: "auto", padding: "2px 8px", fontSize: 11 }}
          >
            clear
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="chat-scroll" onScroll={onChatScroll}>
        {chat.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
            <div style={{ fontStyle: "italic" }}>
              Describe what you want to build.{" "}
              {mode === "plan-then-execute"
                ? "Uniqus will propose a plan first."
                : "Uniqus will start working immediately."}
            </div>
            <div style={{ marginTop: 6, fontStyle: "normal" }}>
              New here?{" "}
              <a
                href="/docs"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent, #a78bfa)", textDecoration: "none" }}
              >
                Read the docs
              </a>
              .
            </div>
            {!connected && (
              <div style={{ marginTop: 10, color: "var(--text-muted)", fontSize: 12 }}>
                Connecting to your workspace…
              </div>
            )}
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontStyle: "normal",
              }}
            >
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  // Gate on the socket — an example that drops into a disabled
                  // composer (during a cold Firecracker boot) reads as broken (§C).
                  disabled={!connected}
                  onClick={() => {
                    setInput(prompt);
                    textareaRef.current?.focus();
                  }}
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "var(--text-primary)",
                    background: "transparent",
                    border: "1px dashed var(--border-default, #2a2a36)",
                    borderRadius: 6,
                    cursor: connected ? "pointer" : "not-allowed",
                    opacity: connected ? 1 : 0.5,
                  }}
                  title={connected ? "Use this prompt" : "Connecting…"}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {hiddenTurnCount > 0 && (
          <button
            type="button"
            className="msg-system"
            onClick={() => setShowAllTurns(true)}
            style={{
              cursor: "pointer",
              width: "100%",
              textAlign: "center",
              background: "transparent",
              border: "1px dashed var(--border-default)",
              borderRadius: 6,
              padding: "6px 10px",
            }}
            title="Render the full conversation"
          >
            ↑ Show {hiddenTurnCount} earlier message{hiddenTurnCount === 1 ? "" : "s"}
          </button>
        )}
        {visibleTurns.map((turn, idx) => {
          const isLast = idx === visibleTurns.length - 1;
          // Past turns (those ending in a `complete` marker) collapse by default;
          // the current in-flight turn (no complete yet) always stays expanded.
          const completeId = turn.complete?.id;
          const expanded = completeId ? !!expandedTurns[completeId] : true;
          return (
            // Per-turn boundary: a single malformed message (bad markdown,
            // unexpected tool payload) renders a small inline fallback instead
            // of throwing and blanking the entire conversation.
            <ErrorBoundary
              key={turn.key}
              variant="inline"
              label="message"
              // Include content-identity signals (not just the positional key)
              // so a boundary that caught a transient mid-stream error clears
              // itself once the turn advances or completes — rather than staying
              // stuck until the manual Retry.
              resetKeys={[turn.key, turn.body.length, turn.complete?.id ?? null]}
            >
              <Turn
                turn={turn}
                expanded={expanded || isLast && !turn.complete}
                onToggle={completeId ? () => toggleTurn(completeId) : undefined}
                handlers={chatHandlers}
                isLastTurn={isLast}
              />
            </ErrorBoundary>
          );
        })}
        {/* The "agent working" indicator now lives as a pinned strip just
            above the composer (see <WorkingStatus/> below) — Claude-Code style —
            instead of an in-stream pill, so it stays put while output scrolls. */}
      </div>

      {/* Agent task list — collapsible, above the composer (shared component). */}
      <TodoList collapsible defaultExpanded={false} />

      {/* Compact sub-agent strip — MOBILE ONLY. On desktop the Activity Monitor
          shows sub-agents; phones can't fit the dashboard, so the live
          sub-agents surface right above the composer instead. */}
      {isMobile && <SubAgentList compact />}

      {busy && (() => {
        // Lead + every sub-agent, so the counter reflects the whole turn (item 3).
        const subIn = subagents.reduce(
          (a, s) => a + s.inputTokens + s.cacheReadTokens + s.cacheCreationTokens,
          0,
        );
        const subOut = subagents.reduce((a, s) => a + s.outputTokens, 0);
        const tokIn = (liveUsage ? liveUsage.input + liveUsage.cacheRead + liveUsage.cacheCreation : 0) + subIn;
        const tokOut = (liveUsage?.output ?? 0) + subOut;
        if (tokIn <= 0 && tokOut <= 0) return null;
        const runningSubs = subagents.filter((s) => s.status === "running").length;
        return (
          <div
            className="live-usage"
            title={`Usage for this response — ${formatTokens(tokIn)} tokens read, ${formatTokens(
              tokOut,
            )} tokens written${
              subagents.length > 0 ? " (lead agent + sub-agents)" : ""
            }. Tokens are the unit AI models bill in.`}
          >
            <span className="live-usage-dot" />
            <span>
              Usage so far · <strong>{formatTokens(tokIn)}</strong> in ·{" "}
              <strong>{formatTokens(tokOut)}</strong> out
              {runningSubs > 0 && (
                <span style={{ opacity: 0.7 }}>
                  {" "}
                  · {runningSubs} sub-agent{runningSubs === 1 ? "" : "s"} working
                </span>
              )}
            </span>
          </div>
        );
      })()}

      {!connected && !connectionFailed && (
        <div className="chat-offline-pill" role="status">
          <span className="chat-offline-dot" aria-hidden="true" />
          <span style={{ flex: 1 }}>Offline — reconnecting…</span>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            your message is kept until you&apos;re back
          </span>
        </div>
      )}

      {connectionFailed && (
        <div
          className="ws-failed-banner"
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 0 6px",
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--text-primary)",
            background: "color-mix(in srgb, var(--conf-low, #c0392b) 14%, transparent)",
            border: "1px solid var(--conf-low, #c0392b)",
            borderRadius: 6,
          }}
        >
          <span style={{ flex: 1 }}>Connection lost.</span>
          <button
            type="button"
            onClick={() => {
              if (project) connect(project.id, sessionParam);
            }}
            disabled={!project}
            className="icon-btn-sm"
            style={{ width: "auto", padding: "2px 10px", fontSize: 11 }}
            title="Reconnect to the workspace"
          >
            Retry
          </button>
        </div>
      )}

      {runReattaching && (
        <div className="install-banner" role="status" aria-live="polite" style={{
          background: "color-mix(in srgb, var(--conf-high, #3ea76a) 13%, transparent)",
          borderColor: "var(--conf-high, #3ea76a)",
        }}>
          <span className="install-spinner" aria-hidden="true" style={{
            borderTopColor: "var(--conf-high, #3ea76a)",
            borderColor: "color-mix(in srgb, var(--conf-high, #3ea76a) 35%, transparent)",
            borderTopWidth: 2, borderStyle: "solid",
          }} />
          <span style={{ flex: 1 }}>
            Reconnected — your build kept running while you were away.
          </span>
        </div>
      )}

      {installInProgress && (
        <div className="install-banner" role="status" aria-live="polite">
          <span className="install-spinner" aria-hidden="true" />
          <span style={{ flex: 1 }}>
            Installing dependencies — this can take a minute.{" "}
            <strong>Don&apos;t refresh.</strong>
          </span>
          <code className="install-cmd" title={installInProgress.command}>
            {installInProgress.command}
          </code>
        </div>
      )}

      {/* Pinned "working" strip — shown for the whole turn, but yields the
          spotlight to the dedicated install / reattach banners above. */}
      {busy && !installInProgress && !runReattaching && (
        <WorkingStatus label={inFlightProgress} />
      )}

      <div
        className={`composer${dragging ? " dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="composer-field">
          {slashMatches.length > 0 && (
            <div
              role="menu"
              aria-label="Slash commands"
              style={{
                marginBottom: 6,
                border: "1px solid var(--border-default, #2a2a36)",
                borderRadius: 6,
                background: "var(--bg-elev, #1a1a22)",
                overflow: "hidden",
              }}
            >
              {slashMatches.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  role="menuitem"
                  aria-selected={i === slashIndex}
                  onClick={() => {
                    setInput(`/${c.name} `);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 12,
                    background: i === slashIndex ? "rgba(255,255,255,0.05)" : "transparent",
                    border: 0,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <code style={{ color: "var(--accent, #a78bfa)" }}>/{c.name}</code>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{c.summary}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                    {c.source === "project" ? "project" : "built-in"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {atMatches.length > 0 && (
            <div
              role="menu"
              aria-label="File references"
              style={{
                marginBottom: 6,
                border: "1px solid var(--border-default, #2a2a36)",
                borderRadius: 6,
                background: "var(--bg-elev, #1a1a22)",
                overflow: "hidden",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {atMatches.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  role="menuitem"
                  aria-selected={i === atIndex}
                  onClick={() => applyAtPick(p)}
                  style={{
                    display: "flex",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "5px 10px",
                    fontSize: 12,
                    background: i === atIndex ? "rgba(255,255,255,0.05)" : "transparent",
                    border: 0,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <code style={{ color: "var(--accent, #a78bfa)", fontSize: 11 }}>@{p}</code>
                </button>
              ))}
            </div>
          )}
          <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setCursor(e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={syncCursor}
            onSelect={syncCursor}
            onKeyUp={syncCursor}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // @file autocomplete navigation
              if (atMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtIndex((i) => (i + 1) % atMatches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtIndex((i) => (i - 1 + atMatches.length) % atMatches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  const pick = atMatches[atIndex] ?? atMatches[0];
                  if (pick) applyAtPick(pick);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setPaletteDismissed(true);
                  return;
                }
              }
              if (slashMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((i) => (i + 1) % slashMatches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  const pick = slashMatches[slashIndex] ?? slashMatches[0];
                  if (pick) setInput(`/${pick.name} `);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setPaletteDismissed(true);
                  return;
                }
              }
              // Tab accepts the ghost-text follow-up suggestion into the input
              // (no palette is open at this point — each returns above). Escape
              // dismisses the hint for this turn without touching the draft.
              if (ghostSuggestion) {
                if (e.key === "Tab") {
                  e.preventDefault();
                  acceptGhostSuggestion();
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setGhostDismissedId(latestComplete?.id ?? null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            // Stays enabled while busy so the user can send a mid-turn steering
            // message (Enter) without stopping the agent — the Stop button is the
            // separate kill switch.
            disabled={uploading || !project || !connected}
            placeholder={
              // The ghost suggestion (when shown) owns the empty-state line, so
              // suppress the native placeholder to avoid two overlaid texts.
              ghostSuggestion
                ? ""
                : busy
                ? "Add a message — Uniqus reads it as it works…"
                : !connected
                ? "Reconnecting…"
                : project
                ? "Describe what to build…"
                : "Connecting…"
            }
            rows={2}
            style={{ resize: "none" }}
          />
          {ghostSuggestion && (
            // Dimmed follow-up hint overlaying the empty textarea. The container
            // is click-THROUGH (pointer-events:none) so clicking the composer to
            // start typing focuses the textarea instead of filling the suggestion
            // (item 8) — only the explicit "Tab" chip (or the Tab key) accepts it.
            <div className="composer-ghost" aria-hidden="true">
              <span className="composer-ghost-text">{ghostSuggestion}</span>
              <span className="composer-ghost-actions">
                <button
                  type="button"
                  className="composer-ghost-key"
                  tabIndex={-1}
                  onClick={acceptGhostSuggestion}
                  title="Use this suggestion (or press Tab)"
                >
                  Tab
                </button>
                <button
                  type="button"
                  className="composer-ghost-off"
                  tabIndex={-1}
                  onClick={() => setSuggestionsEnabled(false)}
                  title="Turn off follow-up suggestions (re-enable in the model menu)"
                  aria-label="Turn off follow-up suggestions"
                >
                  ✕
                </button>
              </span>
            </div>
          )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
          {pendingSelectedElement && (
            <div className="composer-attachments">
              <span className="selected-el-chip" title={pendingSelectedElement.selector}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                <span className="selected-el-chip-label">
                  {describeSelectedElement(pendingSelectedElement)}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingSelectedElement(null)}
                  title="Remove selected element"
                  aria-label="Remove selected element"
                >
                  ×
                </button>
              </span>
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="composer-attachments">
              {pendingFiles.map((file, index) => (
                <span
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="attachment-chip"
                >
                  <span className="attachment-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="attachment-size">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removePendingFile(index)}
                    disabled={uploading}
                    title={`Remove ${file.name}`}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="controls">
            {/* "+" add-menu (item 9): a generic add affordance that opens a small
                menu; file upload lives inside it (room for more actions later). */}
            <div className="composer-plus">
              <button
                type="button"
                onClick={() => setPlusMenuOpen((v) => !v)}
                disabled={busy || uploading || !project}
                className="attach-btn plus"
                title="Add to this message"
                aria-haspopup="menu"
                aria-expanded={plusMenuOpen}
                aria-label="Add to this message"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {plusMenuOpen && (
                <>
                  <button
                    type="button"
                    className="composer-plus-backdrop"
                    aria-label="Close menu"
                    tabIndex={-1}
                    onClick={() => setPlusMenuOpen(false)}
                  />
                  <div className="composer-plus-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPlusMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7l-9.9 9.9a2 2 0 0 1-2.8-2.8l9.4-9.4" />
                      </svg>
                      <span>Upload files</span>
                    </button>
                  </div>
                </>
              )}
            </div>
            <PermissionModePicker />
            <ModelPicker variant="compact" />
            <MicButton
              className="mic-btn"
              disabled={busy || uploading || !project || !connected}
              onText={(t) => setInput((prev) => (prev ? `${prev} ${t}` : t))}
            />
            {busy ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping && !forceStop}
                className="send-btn stop"
                aria-label={
                  forceStop ? "Force stop the agent" : stopping ? "Stopping" : "Stop the agent"
                }
                title={
                  forceStop
                    ? "Force stop — the server is slow to respond; click to stop locally"
                    : stopping
                    ? "Stopping… (waiting for the agent to finish its current step)"
                    : "Stop the agent (cancels current turn)"
                }
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={
                  uploading ||
                  (!input.trim() && pendingFiles.length === 0 && !pendingSelectedElement) ||
                  !project ||
                  !connected
                }
                className="send-btn"
                aria-label={uploading ? "Uploading attachments" : "Send message"}
                title={uploading ? "Uploading attachments…" : "Send message"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmReset && (
        <Modal
          title="Clear chat history?"
          subtitle="This clears the conversation only — your sandbox files are kept."
          width={420}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={confirmResetChat}
                >
                  Clear history
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
            The agent will start fresh with no memory of this conversation.
          </p>
        </Modal>
      )}
    </div>
  );
}

/** Per-message action callbacks, threaded from ChatPanel down to each row. */
interface ChatHandlers {
  /** Load a previous user message back into the composer. */
  onEdit: (text: string) => void;
  /** Re-send a user message / regenerate a turn's answer. */
  onResend: (text: string) => void;
  /** Retry the last run after a failure (C7). */
  onRetryRun: () => void;
  /** Whether send-style actions are currently possible (connected + idle). */
  canAct: boolean;
}

interface Turn {
  key: string;
  /** Items that always render at the top of the turn (user message). */
  head: ChatItem[];
  /** Items that fold away when the turn is collapsed. */
  body: ChatItem[];
  /** The completion marker, if this turn has finished. */
  complete: Extract<ChatItem, { kind: "complete" }> | null;
}

/**
 * Slice the flat chat array into turn groups so each "user → agent → done"
 * cycle can collapse independently.
 *
 * - `user` opens a turn.
 * - `complete` closes a turn and is the toggle anchor.
 * - Anything before the first user (system messages, plan replays) becomes a
 *   prelude turn that's never collapsible.
 */
function buildTurns(chat: ChatItem[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let n = 0;

  const open = (head: ChatItem[]): Turn => ({
    key: `t${n++}`,
    head,
    body: [],
    complete: null,
  });

  for (const item of chat) {
    if (item.kind === "user") {
      if (current) turns.push(current);
      current = open([item]);
      continue;
    }
    if (!current) current = open([]);
    if (item.kind === "complete") {
      current.complete = item;
      turns.push(current);
      current = null;
      continue;
    }
    current.body.push(item);
  }
  if (current) turns.push(current);
  return turns;
}

// A cheap, content-aware signature for one chat item — captures everything
// that affects how the item renders, and crucially the GROWING fields (text
// length, tool result/diff state) so a live turn re-renders while a finished
// one does not. Used by the Turn memo comparator (A3).
function itemSig(it: ChatItem): string {
  switch (it.kind) {
    case "assistant_text":
    case "reasoning":
    case "system":
      return `${it.id}:${it.content.length}`;
    case "tool":
      return `${it.id}:${it.result === undefined ? "p" : it.is_error ? "e" : "r"}:${it.lines_added ?? ""}/${it.lines_removed ?? ""}:${it.imagePaths?.length ?? 0}`;
    case "user_question":
      return `${it.id}:${it.answer ?? ""}`;
    case "tool_approval":
      return `${it.id}:${it.decision ?? "p"}`;
    case "plan_proposal":
      return `${it.id}:${it.status}`;
    case "user":
      return `${it.id}:${it.attachments?.length ?? 0}`;
    default:
      return it.id;
  }
}
function turnSig(t: Turn): string {
  let sig = `${t.key}|${t.complete?.id ?? ""}|`;
  for (const it of t.head) sig += itemSig(it) + ",";
  sig += "#";
  for (const it of t.body) sig += itemSig(it) + ",";
  return sig;
}
function areTurnPropsEqual(
  a: { turn: Turn; expanded: boolean; handlers: ChatHandlers; isLastTurn: boolean },
  b: { turn: Turn; expanded: boolean; handlers: ChatHandlers; isLastTurn: boolean },
): boolean {
  // `onToggle` identity is intentionally ignored: its behavior is fully
  // determined by the turn's complete-marker id, which is in turnSig. `handlers`
  // is a stable useMemo. So a finished turn whose content didn't change is a
  // guaranteed skip even though buildTurns hands us a fresh Turn object.
  return (
    a.expanded === b.expanded &&
    a.isLastTurn === b.isLastTurn &&
    a.handlers === b.handlers &&
    turnSig(a.turn) === turnSig(b.turn)
  );
}

const Turn = memo(function Turn({
  turn,
  expanded,
  onToggle,
  handlers,
  isLastTurn,
}: {
  turn: Turn;
  expanded: boolean;
  onToggle?: () => void;
  handlers: ChatHandlers;
  isLastTurn: boolean;
}) {
  const renderHead = (items: ChatItem[]) =>
    items.map((item) => <ChatItemView key={item.id} item={item} handlers={handlers} />);
  const renderBody = (items: ChatItem[]) =>
    items.map((item, i) => {
      // A reasoning block is "live" only while it's the last item of an
      // in-flight (not-yet-complete) turn — once text/a tool lands after it, the
      // step is done and the trace auto-collapses to a pill (§C).
      const isLiveReasoning =
        item.kind === "reasoning" && !turn.complete && i === items.length - 1;
      return (
        <ChatItemView
          key={item.id}
          item={item}
          handlers={handlers}
          isLiveReasoning={isLiveReasoning}
        />
      );
    });
  const stepCount = turn.body.filter((i) => i.kind === "tool").length;
  const finalText = [...turn.body].reverse().find((i) => i.kind === "assistant_text") as
    | Extract<ChatItem, { kind: "assistant_text" }>
    | undefined;
  const userContent = (
    turn.head.find((i) => i.kind === "user") as Extract<ChatItem, { kind: "user" }> | undefined
  )?.content;

  return (
    <>
      {renderHead(turn.head)}
      {expanded ? (
        renderBody(turn.body)
      ) : (
        // Collapsed view: show only the assistant's final text + a "N steps"
        // disclosure that expands the full body when clicked.
        <>
          {finalText && <ChatItemView item={finalText} handlers={handlers} />}
          {stepCount > 0 && (
            <button
              type="button"
              onClick={onToggle}
              className="msg-system"
              style={{
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "1px dashed var(--border-default)",
                borderRadius: 6,
                padding: "6px 10px",
              }}
              title="Show all steps"
            >
              ▸ {stepCount} step{stepCount === 1 ? "" : "s"} hidden — click to expand
            </button>
          )}
        </>
      )}
      {turn.complete && (
        <CompleteRow
          item={turn.complete}
          expanded={expanded}
          onToggle={onToggle}
          onRegenerate={
            isLastTurn && userContent && handlers.canAct
              ? () => handlers.onResend(userContent)
              : undefined
          }
        />
      )}
    </>
  );
}, areTurnPropsEqual);

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact label for a picked element: "button#submit.cta". */
function describeSelectedElement(el: SelectedElement): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classes.length > 0 ? `.${el.classes.slice(0, 2).join(".")}` : "";
  return `${el.tag || "element"}${id}${cls}` || el.selector;
}

/** Local clock time (HH:MM) for a message timestamp. */
function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Small copy-to-clipboard button with transient "Copied ✓" feedback. */
function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

/** Markdown `pre` renderer that wraps a code block with a hover Copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block-wrap">
      <button
        type="button"
        className="code-copy-btn"
        title="Copy code"
        aria-label="Copy code"
        onClick={() => {
          const text = ref.current?.textContent ?? "";
          navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

// Memoized markdown subtree (A3). ReactMarkdown re-parses its whole input on
// every render; memoizing on `content` means a row that re-renders for a
// non-content reason never reparses, and the growing live block reparses at
// most once per animation frame (WS deltas are coalesced in ws-client). The
// `components` map must be defined once (module scope) so it isn't a new object
// each render — that alone would defeat ReactMarkdown's internal memo.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  pre: CodeBlock,
};
const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

/** Compact token count: 980 → "980", 10800 → "10.8k", 1_250_000 → "1.25M". */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

const FILE_REF_PATTERN = /(?:^|\s)@([\w./-][\w./-]*)/g;

/**
 * Extract `@path/to/file.ts` references from composer text and resolve
 * them against the current file tree. Returns sandbox-relative paths only
 * for tokens that match an existing file — unknown @-tokens are silently
 * dropped so a stray @username doesn't fire spurious file reads.
 */
function extractFileRefs(content: string, validPaths: Set<string>): string[] {
  if (!content || validPaths.size === 0) return [];
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  FILE_REF_PATTERN.lastIndex = 0;
  while ((match = FILE_REF_PATTERN.exec(content)) !== null) {
    const candidate = match[1];
    if (!candidate) continue;
    if (validPaths.has(candidate)) {
      found.add(candidate);
    }
  }
  return Array.from(found);
}

// Memoized (A3). `chat` is rebuilt on every streamed token, so without this
// every row re-rendered per token — the freeze. Only the ONE growing
// assistant_text block gets a new object reference from the store; all other
// items keep their reference, and `handlers` is a stable useMemo, so memo skips
// re-rendering (and re-parsing markdown for) every unchanged row.
const ChatItemView = memo(function ChatItemView({
  item,
  handlers,
  isLiveReasoning = false,
}: {
  item: ChatItem;
  handlers: ChatHandlers;
  isLiveReasoning?: boolean;
}) {
  if (item.kind === "user") {
    return (
      <div className="msg">
        <div className="head">
          <span className="av">Y</span>
          <span className="name">You</span>
          {item.at !== undefined && (
            <span className="msg-time" title={new Date(item.at).toLocaleString()}>
              {formatClock(item.at)}
            </span>
          )}
          <span className="msg-actions">
            <button
              type="button"
              className="msg-action-btn"
              title="Edit in the composer"
              aria-label="Edit this message"
              onClick={() => handlers.onEdit(item.content)}
            >
              Edit
            </button>
            <button
              type="button"
              className="msg-action-btn"
              title="Send this message again"
              aria-label="Resend this message"
              disabled={!handlers.canAct}
              onClick={() => handlers.onResend(item.content)}
            >
              Resend
            </button>
          </span>
        </div>
        <div className="msg-body user">
          {item.content}
          {item.attachments && item.attachments.length > 0 && (
            <div className="message-attachments">
              {item.attachments.map((file) => (
                <span key={file.path} className="message-attachment">
                  <span className="attachment-name" title={file.path}>
                    {file.name}
                  </span>
                  <code>{file.path}</code>
                  <span>{formatFileSize(file.size)}</span>
                </span>
              ))}
            </div>
          )}
          {item.fileRefs && item.fileRefs.length > 0 && (
            <div className="message-file-refs">
              <span className="message-file-refs-label">included:</span>
              {item.fileRefs.map((ref) => (
                <code key={ref} className="message-file-ref" title={ref}>
                  @{ref}
                </code>
              ))}
            </div>
          )}
          {item.selectedElement && (
            <div className="message-file-refs">
              <span className="message-file-refs-label">element:</span>
              <code className="message-file-ref" title={item.selectedElement.selector}>
                {describeSelectedElement(item.selectedElement)}
              </code>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (item.kind === "assistant_text") {
    return (
      <div className="msg">
        <div className="head">
          <span className="av agent">U</span>
          <span className="name">Uniqus</span>
          <span className="frame">Engineering agent</span>
          <span className="msg-actions">
            <CopyButton text={item.content} label="Copy" className="msg-action-btn" />
          </span>
        </div>
        <div className="msg-body" style={{ paddingLeft: 30 }}>
          <Markdown content={item.content} />
        </div>
      </div>
    );
  }
  if (item.kind === "reasoning") {
    return <ReasoningCard item={item} isLive={isLiveReasoning} />;
  }
  if (item.kind === "tool") {
    return <ToolCard item={item} />;
  }
  if (item.kind === "user_question") {
    return <UserQuestionCard item={item} />;
  }
  if (item.kind === "tool_approval") {
    return <ToolApprovalCard item={item} />;
  }
  if (item.kind === "plan_proposal") {
    return <PlanReview item={item} />;
  }
  if (item.kind === "system") {
    return <div className="msg-system">{item.content}</div>;
  }
  if (item.kind === "routing") {
    return <RoutingChip item={item} />;
  }
  if (item.kind === "error") {
    return (
      <ErrorCard
        item={item}
        onRetry={handlers.onRetryRun}
        onSimplify={() =>
          handlers.onEdit("Try that again, but take a simpler, more reliable approach.")
        }
        canAct={handlers.canAct}
      />
    );
  }
  return null;
});

/**
 * Compact "⚡ Auto → <model>" chip shown at the top of an Auto turn, so the user
 * can see which model task-aware routing picked (and the task tier it inferred).
 * Self-contained inline styles off the design tokens — it's a muted, secondary
 * affordance, not agent output. Falls back to the raw provider-native id if the
 * model isn't in the catalog.
 */
function RoutingChip({ item }: { item: Extract<ChatItem, { kind: "routing" }> }) {
  const entry = MODEL_CATALOG.find(
    (m) => m.model === item.model && m.provider === item.provider,
  );
  const label = entry?.label ?? item.model;
  const why = [item.tier, item.vision ? "vision" : null].filter(Boolean).join(" · ");
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        color: "var(--text-dim)",
        fontFamily: "var(--font-mono, ui-monospace, Menlo, Consolas, monospace)",
        padding: "1px 0 3px",
        userSelect: "none",
      }}
      title={`Auto routed this turn to ${label}${item.tier ? ` (${item.tier} task)` : ""}`}
    >
      <span aria-hidden style={{ color: "var(--brand-magenta, #d4439a)" }}>⚡</span>
      <span>
        Auto → <strong style={{ color: "var(--text-muted)", fontWeight: 600 }}>{label}</strong>
      </span>
      {why && <span style={{ opacity: 0.65 }}>· {why}</span>}
    </div>
  );
}

function ErrorCard({
  item,
  onRetry,
  onSimplify,
  canAct,
}: {
  item: Extract<ChatItem, { kind: "error" }>;
  onRetry: () => void;
  onSimplify: () => void;
  canAct: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const copy = errorCopyFor(item.code, item.message);
  return (
    <div className="error-card" role="alert">
      <div className="error-card-head">
        <span className="error-card-icon" aria-hidden="true">
          ⚠
        </span>
        <span className="error-card-title">{copy.title}</span>
      </div>
      <p className="error-card-plain">{copy.plain}</p>
      {copy.suggestions.length > 0 && (
        <ul className="error-card-suggestions">
          {copy.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <div className="error-card-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={onRetry}
          disabled={!canAct}
          title={canAct ? "Run the last request again" : "Available once the agent is idle and connected"}
        >
          ↻ Retry run
        </button>
        <button
          type="button"
          className="msg-action-btn"
          onClick={onSimplify}
          title="Put a 'try a simpler approach' prompt in the composer"
        >
          Simplify request
        </button>
        <button
          type="button"
          className="msg-action-btn"
          onClick={() => setShowRaw((v) => !v)}
          aria-expanded={showRaw}
        >
          {showRaw ? "Hide details" : "Technical details"}
        </button>
      </div>
      {showRaw && <pre className="error-card-raw">{item.message}</pre>}
    </div>
  );
}

function UserQuestionCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "user_question" }>;
}) {
  const resolveUserQuestion = useStore((s) => s.resolveUserQuestion);
  const [freeText, setFreeText] = useState("");
  // Surfaced when send() fails (socket down). Without it the click was a silent
  // no-op — the answer buttons stayed live but nothing happened. Cleared on a
  // successful send (or a fresh attempt).
  const [sendError, setSendError] = useState<string | null>(null);
  const answered = item.answer !== undefined;

  const submit = (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed || answered) return;
    const ok = send({
      type: "user_question_answered",
      call_id: item.call_id,
      answer: trimmed,
    });
    if (ok) {
      setSendError(null);
      resolveUserQuestion(item.call_id, trimmed);
    } else {
      // Keep the answer controls enabled so the user can retry once the socket
      // reconnects, rather than losing their selection to a dropped frame.
      setSendError("Couldn't send — reconnecting. Try again.");
    }
  };

  return (
    <div className="msg">
      <div className="head">
        <span className="av agent">?</span>
        <span className="name">Uniqus is asking</span>
        <span className="frame">needs your input</span>
      </div>
      <div className="msg-body" style={{ paddingLeft: 30 }}>
        <div className="ask-user-card">
          <div className="ask-user-question">{item.question}</div>
          {answered ? (
            <div className="ask-user-answer">
              <span className="ask-user-answer-label">You answered:</span>{" "}
              <span className="ask-user-answer-text">{item.answer}</span>
            </div>
          ) : (
            <>
              {item.options && item.options.length > 0 && (
                <div className="ask-user-options">
                  {item.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => submit(opt)}
                      className="ask-user-option"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {item.allow_free_text && (
                <form
                  className="ask-user-free"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(freeText);
                  }}
                >
                  <input
                    type="text"
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder={
                      item.options && item.options.length > 0
                        ? "Or type your own answer…"
                        : "Type your answer…"
                    }
                    autoFocus
                  />
                  <button type="submit" disabled={!freeText.trim()}>
                    Answer
                  </button>
                </form>
              )}
              {sendError && (
                <div
                  role="alert"
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--conf-low, #c0392b)",
                  }}
                >
                  {sendError}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const APPROVAL_CATEGORY_LABEL: Record<string, string> = {
  edit: "File change",
  execute: "Command",
  dangerous: "Dangerous / costly",
};

function ToolApprovalCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool_approval" }>;
}) {
  const resolveToolApproval = useStore((s) => s.resolveToolApproval);
  const [reason, setReason] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const decided = item.decision !== undefined;

  const respond = (decision: "approve" | "approve_always" | "deny"): void => {
    if (decided) return;
    const ok = send({
      type: "tool_approval_response",
      call_id: item.call_id,
      decision,
      feedback: decision === "deny" && reason.trim() ? reason.trim() : undefined,
    });
    if (ok) {
      setSendError(null);
      resolveToolApproval(item.call_id, decision);
    } else {
      setSendError("Couldn't send — reconnecting. Try again.");
    }
  };

  const verdictText =
    item.decision === "approve"
      ? "Approved"
      : item.decision === "approve_always"
        ? `Approved — won't ask again for ${item.tool} this turn`
        : item.decision === "deny"
          ? "Declined"
          : null;

  return (
    <div className="msg">
      <div className="head">
        <span className="av agent">!</span>
        <span className="name">Permission needed</span>
        <span className="frame">{APPROVAL_CATEGORY_LABEL[item.category] ?? "Action"}</span>
      </div>
      <div className="msg-body" style={{ paddingLeft: 30 }}>
        <div className="ask-user-card">
          <div className="ask-user-question" style={{ fontWeight: 600 }}>
            {item.summary}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
            {item.reason}
          </div>
          {decided ? (
            <div className="ask-user-answer" style={{ marginTop: 8 }}>
              <span className="ask-user-answer-text">{verdictText}</span>
            </div>
          ) : (
            <>
              <div className="ask-user-options" style={{ marginTop: 10 }}>
                <button type="button" onClick={() => respond("approve")} className="ask-user-option">
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => respond("approve_always")}
                  className="ask-user-option"
                  title={`Run this and stop asking for ${item.tool} for the rest of this turn`}
                >
                  Approve, don't ask again
                </button>
                <button
                  type="button"
                  onClick={() => respond("deny")}
                  className="ask-user-option"
                  style={{ borderColor: "var(--conf-low, #c0392b)" }}
                >
                  Reject
                </button>
              </div>
              <form
                className="ask-user-free"
                style={{ marginTop: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  respond("deny");
                }}
              >
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Optional: tell the agent why / what to do instead…"
                />
              </form>
              {sendError && (
                <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "var(--conf-low, #c0392b)" }}>
                  {sendError}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "$0.40", "<$0.01" for sub-cent, "$1.20" — never implies a charged amount. */
function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function CompleteRow({
  item,
  expanded,
  onToggle,
  onRegenerate,
}: {
  item: Extract<ChatItem, { kind: "complete" }>;
  expanded: boolean;
  onToggle?: () => void;
  onRegenerate?: () => void;
}) {
  const [changesOpen, setChangesOpen] = useState(false);
  const parts = [
    item.aborted ? "aborted" : "done",
    `${item.tool_calls} tool calls`,
  ];
  // elapsed_ms is 0 on replayed turns (we don't persist per-turn wall-clock) —
  // skip it rather than show a misleading "0.0s".
  if (item.elapsed_ms > 0) parts.push(`${(item.elapsed_ms / 1000).toFixed(1)}s`);
  if (item.input_tokens !== undefined || item.output_tokens !== undefined) {
    // Include sub-agent tokens so the summary matches the true turn spend the
    // cost reflects (item 3). The lead figures already fold in the plan phase.
    const tokIn = (item.input_tokens ?? 0) + (item.subagent_input_tokens ?? 0);
    const tokOut = (item.output_tokens ?? 0) + (item.subagent_output_tokens ?? 0);
    parts.push(`${formatTokens(tokIn)} in · ${formatTokens(tokOut)} out`);
  }
  // Per-run cost estimate (C5). "est." kept deliberately — there's no billing
  // system; this is a best-effort number, not a charge. When sub-agents ran this
  // turn, fold their per-model cost into the figure so it reflects the TRUE turn
  // cost (lead + delegated), and note the count.
  const turnCost = (item.cost_usd ?? 0) + (item.subagent_cost_usd ?? 0);
  if (turnCost > 0) {
    parts.push(`≈ ${formatCost(turnCost)} est.`);
  }
  if (item.subagent_count && item.subagent_count > 0) {
    parts.push(`${item.subagent_count} sub-agent${item.subagent_count === 1 ? "" : "s"}`);
  }
  const summary = parts.join(" · ");
  const changed = item.changed_files ?? [];
  return (
    <div className="complete-row">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={onToggle}
          className="msg-system"
          style={{
            cursor: onToggle ? "pointer" : "default",
            flex: 1,
            textAlign: "left",
            background: "transparent",
            border: "none",
            padding: "4px 0",
            opacity: 0.75,
          }}
          title={
            onToggle
              ? expanded
                ? "Collapse this turn"
                : "Expand this turn"
              : item.model
                ? `Ran on ${item.model}`
                : undefined
          }
        >
          {onToggle ? (expanded ? "▾ " : "▸ ") : ""}
          {summary}
        </button>
        {onRegenerate && (
          <button
            type="button"
            className="msg-action-btn"
            onClick={onRegenerate}
            title="Run this turn again from the same prompt"
            aria-label="Regenerate this response"
            style={{ flex: "0 0 auto" }}
          >
            ↻ Regenerate
          </button>
        )}
      </div>

      {/* What changed — deterministic, tool-derived file list (C6 Tier-1). */}
      {changed.length > 0 && (
        <div className="changed-files">
          <button
            type="button"
            className="changed-toggle"
            onClick={() => setChangesOpen((v) => !v)}
            aria-expanded={changesOpen}
          >
            {changesOpen ? "▾" : "▸"} What changed · {changed.length} file
            {changed.length === 1 ? "" : "s"}
          </button>
          {changesOpen && (
            <ul className="changed-list">
              {changed.map((f) => (
                <li key={f.path}>
                  <span className={`changed-action ${f.action}`}>
                    {f.action === "created" ? "New" : f.action === "deleted" ? "Removed" : "Edited"}
                  </span>
                  <code className="changed-path">{f.path}</code>
                  <span className="changed-diff">
                    <span className="add">+{f.lines_added}</span>{" "}
                    <span className="rem">−{f.lines_removed}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ReasoningCard({
  item,
  isLive,
}: {
  item: Extract<ChatItem, { kind: "reasoning" }>;
  isLive: boolean;
}) {
  // Open while the step is live so the trace streams in view; auto-collapses to
  // a "Thought for Ns" pill once the step finishes so past reasoning doesn't
  // bury the answer (§C). Still manually re-openable.
  const [expanded, setExpanded] = useState(isLive);
  // Timestamp the first and last thinking delta as the trace streams in.
  const firstAtRef = useRef<number | null>(null);
  const lastAtRef = useRef<number | null>(null);
  const [finalMs, setFinalMs] = useState<number | null>(null);
  // Re-render tick while live so the label can flip from "Thinking…" to a frozen
  // "Thought for Ns" once the deltas stop, without waiting for the next item.
  const [, tick] = useState(0);

  // Each thinking delta grows item.content; stamp first + last delta times.
  useEffect(() => {
    const now = Date.now();
    if (firstAtRef.current === null) firstAtRef.current = now;
    lastAtRef.current = now;
  }, [item.content]);

  // Finalize the duration to the LAST thinking delta — NOT to when the next chat
  // item (a tool call / answer text) lands. On Gemini a function call (e.g.
  // write_file's whole contents) is generated and delivered atomically AFTER
  // thinking ends, so measuring to the next item counted that file-writing time
  // as "thinking". Measuring delta-span counts only the actual reasoning, for
  // every provider.
  useEffect(() => {
    if (
      !isLive &&
      finalMs === null &&
      firstAtRef.current !== null &&
      lastAtRef.current !== null
    ) {
      setFinalMs(Math.max(0, lastAtRef.current - firstAtRef.current));
    }
  }, [isLive, finalMs]);

  useEffect(() => {
    if (!isLive) {
      setExpanded(false);
      return;
    }
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [isLive]);

  // "Actively thinking" = a delta arrived recently. Once they stop (the model
  // moved on to generating output / tool args) freeze the shown time rather than
  // implying it's still thinking through a long post-thinking pause.
  const streamingThought =
    isLive && (lastAtRef.current === null || Date.now() - lastAtRef.current < 900);
  const shownMs =
    finalMs ??
    (firstAtRef.current !== null && lastAtRef.current !== null
      ? lastAtRef.current - firstAtRef.current
      : 0);
  const label = streamingThought
    ? "Thinking…"
    : shownMs >= 1000
    ? `Thought for ${Math.round(shownMs / 1000)}s`
    : "Thought";

  return (
    <div className="reasoning-card">
      <button
        type="button"
        className="reasoning-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded ? "true" : "false"}
      >
        <span>💭 {label}</span>
        <span className="reasoning-chevron">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && <div className="reasoning-body">{item.content}</div>}
    </div>
  );
}

/**
 * Codex-style one-line activity phrase for a tool call (B5): a natural-language
 * verb + object so the chat reads as a sentence ("Writing `index.html`",
 * "Running `npm install`", "Searching the web for …") instead of a raw
 * `write_file` name. `mono` styles the object as code (paths, commands,
 * patterns). The raw tool name is still surfaced via the card's
 * `data-tool`/`title` for power users.
 *
 * TENSE tracks state: while the tool is still running the verb is present-tense
 * ("Writing", "Running"); once it finishes it flips to past-tense ("Wrote",
 * "Ran"). `done` = the tool result has arrived. Each entry gives the (present,
 * past) pair; a couple of state-verbs ("Checked running servers") reuse one form
 * for both. The object (path/command/query) fills in live as the arguments
 * stream, so the blank "Writing …" placeholder is replaced the moment the file
 * name is known.
 */
function describeTool(
  name: string,
  input: unknown,
  done: boolean,
): { verb: string; object?: string; mono?: boolean } {
  const a = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  // Accept the alternate arg names a model may stream (file_path / file) so the
  // file name isn't blank while the args are still arriving (item 4).
  const path = str(a.path) || str(a.file_path) || str(a.file);
  // Pick the tense-appropriate verb from a (present, past) pair.
  const v = (present: string, past: string) => (done ? past : present);
  switch (name) {
    case "write_file":
      // Until the path streams in, show a subtle placeholder rather than a blank
      // gap after "Writing" (item 4).
      return { verb: v("Writing", "Wrote"), object: path || (done ? "" : "…"), mono: !!path };
    case "edit_file":
      return { verb: v("Editing", "Edited"), object: path || (done ? "" : "…"), mono: !!path };
    case "read_file":
      return { verb: v("Reading", "Read"), object: path, mono: true };
    case "list_dir":
      return { verb: v("Listing", "Listed"), object: path || "the project", mono: !!path };
    case "grep":
      return { verb: v("Searching for", "Searched for"), object: str(a.pattern), mono: true };
    case "run_command":
      return { verb: v("Running", "Ran"), object: str(a.command), mono: true };
    case "web_search":
      return {
        verb: v("Searching the web for", "Searched the web for"),
        object: str(a.query) ? `"${str(a.query)}"` : "",
      };
    case "knowledge_search":
      return {
        verb: v("Searching your knowledge for", "Searched your knowledge for"),
        object: str(a.query) ? `"${str(a.query)}"` : "",
      };
    case "start_server":
      return { verb: v("Starting the app", "Started the app"), object: a.port ? `on :${a.port}` : "" };
    case "stop_server":
      return { verb: v("Stopping the app", "Stopped the app") };
    case "list_servers":
      return { verb: v("Checking running servers", "Checked running servers") };
    case "read_server_log":
      return { verb: v("Reading the server log", "Read the server log") };
    case "wait_for_port":
      return { verb: v("Waiting for", "Waited for"), object: a.port ? `port ${a.port}` : "the server" };
    case "screenshot_preview":
      return { verb: v("Taking a screenshot", "Took a screenshot") };
    case "interact_preview":
      return {
        verb: v("Testing in the browser", "Tested in the browser"),
        object: str(a.url) || str(a.server_id) || "",
        mono: !!(a.url || a.server_id),
      };
    case "run_flow":
      return { verb: v("Replaying flow", "Replayed flow"), object: str(a.name), mono: !!a.name };
    case "save_flow":
      return { verb: v("Saving a test flow", "Saved a test flow"), object: str(a.name), mono: !!a.name };
    case "list_flows":
      return { verb: v("Listing saved flows", "Listed saved flows") };
    case "read_asset":
      return { verb: v("Viewing", "Viewed"), object: path || "an asset", mono: !!path };
    case "list_assets":
      return { verb: v("Listing assets", "Listed assets") };
    case "todo_write":
      return { verb: v("Updating the task list", "Updated the task list") };
    case "ask_user":
      return { verb: v("Asking you", "Asked you"), object: str(a.question) };
    // Image generation + vision tools. Explicit so they read as proper phrases
    // ("Generating an image") instead of the mangled snake_case fallback that
    // conjugated the whole phrase ("generate_image" → "Generate imaging"; item 5).
    case "generate_image":
      return {
        verb: v("Generating an image", "Generated an image"),
        object: str(a.prompt) ? `“${str(a.prompt).slice(0, 60)}”` : "",
      };
    case "analyze_image":
      return { verb: v("Analyzing an image", "Analyzed an image"), object: str(a.question) };
    case "extract_text_from_image":
      return { verb: v("Reading text from an image", "Read text from an image") };
    case "ui_screenshot_to_code":
      return { verb: v("Turning a screenshot into code", "Turned a screenshot into code") };
    case "diagnose_screenshot":
      return { verb: v("Diagnosing a screenshot", "Diagnosed a screenshot") };
    case "understand_diagram":
      return { verb: v("Reading a diagram", "Read a diagram") };
    case "analyze_chart":
      return { verb: v("Analyzing a chart", "Analyzed a chart") };
    case "compare_ui":
      return { verb: v("Comparing the UI", "Compared the UI") };
    default: {
      // snake_case → "Verb object" fallback so a new/unknown tool still reads as
      // a phrase: "run_migration" → "Running migration". Conjugate ONLY the first
      // word (the verb) — the old code appended "ing" to the WHOLE phrase, so
      // "generate image" became "generate imaging" (item 5).
      const words = name.replace(/_/g, " ").trim().split(/\s+/).filter(Boolean);
      const rawVerb = words[0] ?? name;
      const rest = words.slice(1).join(" ");
      const cap = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());
      const gerund =
        rawVerb.length > 2 && rawVerb.endsWith("e")
          ? `${rawVerb.slice(0, -1)}ing`
          : `${rawVerb}ing`;
      const verb = cap(done ? rawVerb : gerund);
      const first = a.path ?? a.url ?? a.query ?? a.command ?? a.name ?? a.pattern ?? a.prompt ?? a.id ?? a.server_id;
      const argObject =
        typeof first === "string" || typeof first === "number" ? String(first) : undefined;
      // Prefer the snake_case remainder as the plain object ("run_migration" →
      // "migration"); fall back to a streamed arg value (rendered mono).
      const object = rest || argObject;
      return { verb, object, mono: !rest && argObject !== undefined };
    }
  }
}

function ToolCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool" }>;
}) {
  const isError = item.is_error === true;
  // Auto-expand errors so the reason is visible without a click (§C).
  const [expanded, setExpanded] = useState(isError);
  const hasResult = item.result !== undefined;
  // Present tense while running ("Writing app.tsx"), past once done ("Wrote").
  const desc = describeTool(item.name, item.input, hasResult);
  // Interaction tools stream a live screenshot run into the Preview (Agent) tab;
  // offer a jump so the user can watch it instead of reading the text result.
  const isInteraction = item.name === "interact_preview" || item.name === "run_flow";
  const setEditorTab = useStore((s) => s.setEditorTab);
  const projectId = useStore((s) => s.project?.id);
  // Inline screenshot thumbnails: only for the deliberate capture / vision tools
  // (interact_preview has its own live "Preview (Agent)" tab, so it's excluded).
  const thumbs = THUMBNAIL_TOOLS.has(item.name) ? item.imagePaths : undefined;
  // First non-empty line of the error, shown inline in the collapsed card so a
  // failure isn't just a bare red badge.
  const errorPreview =
    isError && item.result
      ? (item.result.split("\n").find((l) => l.trim()) ?? item.result).slice(0, 140)
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="tool-card"
        data-tool={item.name}
        title={`${item.name}${hasResult ? "" : " (running)"} — click to ${expanded ? "hide" : "show"} details`}
      >
        <div className="row">
          <span className={`name ${isError ? "error" : ""}`}>{desc.verb}</span>
          {desc.object && <span className="summary">{desc.object}</span>}
          {(item.lines_added !== undefined || item.lines_removed !== undefined) && (
            <span
              className="tool-diff"
              style={{ fontSize: 11, fontFamily: "ui-monospace,Menlo,Consolas,monospace", whiteSpace: "nowrap" }}
              title={`${item.lines_added ?? 0} added, ${item.lines_removed ?? 0} removed`}
            >
              <span style={{ color: "var(--conf-high, #3ea76a)" }}>+{item.lines_added ?? 0}</span>{" "}
              <span style={{ color: "var(--conf-medium, #d98a3d)" }}>−{item.lines_removed ?? 0}</span>
            </span>
          )}
          <span className={`status ${!hasResult ? "run" : isError ? "err" : "ok"}`}>
            {!hasResult ? "running…" : isError ? "error" : "✓"}
          </span>
        </div>
        {isError && errorPreview && !expanded && (
          <div className="tool-error-preview">{errorPreview}</div>
        )}
        {expanded && hasResult && <pre className={isError ? "err" : ""}>{item.result}</pre>}
      </button>
      {isInteraction && (
        <button
          type="button"
          className="tool-fix-btn"
          title="Open the Preview (Agent) tab to watch this interaction"
          onClick={() => setEditorTab(AGENT_PREVIEW_TAB)}
        >
          Open Preview (Agent) ↗
        </button>
      )}
      {thumbs && thumbs.length > 0 && projectId && (
        <div className="tool-shots">
          {thumbs.map((p) => (
            <ToolShot key={p} projectId={projectId} path={p} />
          ))}
        </div>
      )}
    </>
  );
}

/** Tools whose result carries an image worth previewing inline (NOT interact_preview). */
const THUMBNAIL_TOOLS = new Set<string>([
  "screenshot_preview",
  "analyze_image",
  "extract_text_from_image",
  "ui_screenshot_to_code",
  "diagnose_screenshot",
  "understand_diagram",
  "analyze_chart",
  "compare_ui",
]);

/**
 * A small rounded inline thumbnail of a screenshot/analyzed image. Loads the
 * sandbox file through the project's authenticated /raw/ endpoint (same path the
 * editor's image viewer uses) into an object URL, and renders nothing if the file
 * is gone (e.g. pruned by the screenshot-retention cap) — so a stale path degrades
 * quietly instead of showing a broken-image icon. Click opens the full image.
 */
function ToolShot({ projectId, path }: { projectId: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setUrl(null);
    setFailed(false);
    fetch(`${getApiBase()}/api/projects/${projectId}/raw/${encodeURIComponent(path)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, path]);
  if (failed) return null;
  return (
    <a
      className="tool-shot"
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={`${path} — open full size`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: object URL, not a static asset
        <img src={url} alt="screenshot preview" loading="lazy" />
      ) : (
        <span className="tool-shot-ph" aria-hidden="true" />
      )}
    </a>
  );
}

