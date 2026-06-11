"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClientEvent, UploadedFileSummary } from "@uniqus/api-types";
import {
  fetchSlashCommandsApi,
  uploadProjectFilesApi,
  type SlashCommandSummary,
} from "@/lib/api";
import { useStore, type ChatItem, type SelectedElement } from "@/lib/store";
import { errorCopyFor } from "@/lib/errorCopy";
import { connect, send } from "@/lib/ws-client";
import PlanReview from "./PlanReview";
import ChatSessionDropdown from "./ChatSessionDropdown";
import ModelPicker from "./ModelPicker";
import MicButton from "./MicButton";
import Modal from "./Modal";
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

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const installInProgress = useStore((s) => s.installInProgress);
  const runReattaching = useStore((s) => s.runReattaching);
  const mode = useStore((s) => s.mode);
  const setModeManual = useStore((s) => s.setModeManual);
  const model = useStore((s) => s.model);
  const thinking = useStore((s) => s.thinking);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const addSystem = useStore((s) => s.addSystem);
  const setBusy = useStore((s) => s.setBusy);
  const project = useStore((s) => s.project);
  const connected = useStore((s) => s.connected);
  const connectionFailed = useStore((s) => s.connectionFailed);
  const expandedTurns = useStore((s) => s.expandedTurns);
  const toggleTurn = useStore((s) => s.toggleTurn);
  const todos = useStore((s) => s.todos);
  const liveUsage = useStore((s) => s.liveUsage);
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
  const [tasksExpanded, setTasksExpanded] = useState(false);
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

  // Auto-resize textarea: grow with the content, then scroll. Grows up to
  // ~15 lines on a tall screen, but never past ~30% of the viewport — otherwise
  // a long draft swallows half a short (mobile) screen, which is exactly the
  // "the chatbox takes up half the screen on mobile" complaint. Keeps the
  // compact, hero-composer feel at every size.
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 20; // approx line-height in px
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    // Phones get a tighter cap — at 30vh the composer dominates a short screen.
    const isNarrow = typeof window !== "undefined" && window.innerWidth <= 760;
    const maxHeight = Math.min(lineHeight * 15, Math.round(vh * (isNarrow ? 0.22 : 0.3)));
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  // Recompute on viewport changes (rotation, on-screen keyboard) so the cap
  // tracks the live screen height.
  useEffect(() => {
    window.addEventListener("resize", autoResize);
    return () => window.removeEventListener("resize", autoResize);
  }, [autoResize]);

  // Recompute when the textarea's own width changes (pane switches, panel
  // drags, the first mobile layout pass). scrollHeight depends on width — a
  // measurement taken while the box was momentarily narrow (placeholder
  // wrapped into many lines) would otherwise stick as a huge inline height,
  // leaving an empty composer that swallows a third of a phone screen.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || typeof ResizeObserver === "undefined") return;
    let lastWidth = ta.clientWidth;
    const ro = new ResizeObserver(() => {
      if (ta.clientWidth !== lastWidth) {
        lastWidth = ta.clientWidth;
        autoResize();
      }
    });
    ro.observe(ta);
    return () => ro.disconnect();
  }, [autoResize]);

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
        model: model !== "auto" ? model : undefined,
        thinking: thinking !== "medium" ? thinking : undefined,
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
      setBusy(true);
      return true;
    },
    [busy, uploading, project, connected, mode, model, thinking, validFilePaths, addSystem, addUserMessage, setBusy],
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

  // Hand a failed tool's error back to the agent with a "fix it" framing (§C
  // error→fix loop; the frontend slice — no terminal needed).
  const handleFixError = useCallback(
    (name: string, result: string) => {
      const snippet = (result || "").slice(0, 1500);
      void sendText(
        `The \`${name}\` step failed. Please diagnose the cause and fix it.\n\n\`\`\`\n${snippet}\n\`\`\``,
      );
    },
    [sendText],
  );

  const chatHandlers = useMemo<ChatHandlers>(
    () => ({
      onEdit: handleEditMessage,
      onResend: handleResend,
      onFixError: handleFixError,
      onRetryRun: handleRetryRun,
      canAct: connected && !busy,
    }),
    [handleEditMessage, handleResend, handleFixError, handleRetryRun, connected, busy],
  );

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    // Snapshot the picked element now — it's valid context even with no text.
    const selectedElement = pendingSelectedElement;
    if (
      (!trimmed && pendingFiles.length === 0 && !selectedElement) ||
      busy ||
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

    // The upload await above could have spanned a disconnect or the start of
    // another turn (e.g. an auto-retry). Re-check before send() so we don't
    // echo a bubble and clear the composer against a closed socket / busy
    // session — mirrors the pre-upload guard and the ok-check below.
    if (!connected || busy) {
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
      model: model !== "auto" ? model : undefined,
      thinking: thinking !== "medium" ? thinking : undefined,
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
                href="/guide"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent, #a78bfa)", textDecoration: "none" }}
              >
                Read the guide
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
        {busy && (() => {
          // Show a thinking indicator when the agent is working but no tool
          // calls or text have streamed yet (e.g. planning, booting VM).
          const lastTurn = turns[turns.length - 1];
          const inFlight = lastTurn && !lastTurn.complete ? lastTurn : null;
          // Real streamed output (assistant text, tool cards) renders its own
          // rows, so the pill is redundant once any non-system item lands. A
          // `system` progress note (rendered muted in-line) does NOT count as
          // visible activity — it instead becomes the pill's label below.
          const hasVisibleActivity =
            !!inFlight && inFlight.body.some((i) => i.kind !== "system");
          if (hasVisibleActivity) return null;
          // Surface server progress (e.g. "Starting sandbox…", "Installing
          // dependencies…"): the most recent `system` item of the in-flight
          // turn, if any, takes precedence over the generic "Thinking…".
          const lastSystem = inFlight
            ? [...inFlight.body].reverse().find((i) => i.kind === "system")
            : undefined;
          const progress =
            lastSystem && lastSystem.kind === "system" ? lastSystem.content : null;
          const label =
            progress ??
            (mode === "plan-then-execute" ? "Thinking about a plan…" : "Thinking…");
          return (
            <div className="msg">
              <div className="head">
                <span className="av agent">U</span>
                <span className="name">Uniqus</span>
                <span className="frame thinking-indicator">{label}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Inline tasks bar — collapsible, above the composer */}
      {todos.length > 0 && (
        <div className="tasks-inline">
          <button
            type="button"
            className="tasks-inline-toggle"
            onClick={() => setTasksExpanded((v) => !v)}
          >
            <span className="tasks-inline-summary">
              {(() => {
                const done = todos.filter((t) => t.status === "completed").length;
                const inFlight = todos.find((t) => t.status === "in_progress");
                return (
                  <>
                    <span style={{ opacity: 0.6 }}>Tasks {done}/{todos.length}</span>
                    {inFlight && (
                      <span className="tasks-inline-active">
                        <span title="In progress" role="img" aria-label="In progress">
                          ▶
                        </span>{" "}
                        {inFlight.activeForm}
                      </span>
                    )}
                  </>
                );
              })()}
            </span>
            <span style={{ fontSize: 10, opacity: 0.5 }}>{tasksExpanded ? "▾" : "▸"}</span>
          </button>
          {tasksExpanded && (
            <div className="tasks-inline-list">
              {todos.map((t) => {
                const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "▶" : "·";
                const stateLabel =
                  t.status === "completed"
                    ? "Completed"
                    : t.status === "in_progress"
                    ? "In progress"
                    : "Pending";
                const color = t.status === "completed" ? "var(--text-dim)" : t.status === "in_progress" ? "var(--accent, #a78bfa)" : "var(--text-primary)";
                const label = t.status === "in_progress" ? t.activeForm : t.content;
                return (
                  // Key on the todo's stable text (TodoItem has no id), not the
                  // array index — index keys mismatch state/DOM when the list
                  // reorders. content+activeForm disambiguates any duplicates.
                  <div
                    key={`${t.content} ${t.activeForm}`}
                    className="tasks-inline-item"
                    style={{ color }}
                  >
                    <span
                      title={stateLabel}
                      role="img"
                      aria-label={stateLabel}
                      style={{ fontFamily: "var(--font-mono-stack)", fontSize: 11 }}
                    >
                      {icon}
                    </span>
                    <span style={{ textDecoration: t.status === "completed" ? "line-through" : "none" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {busy && liveUsage && (liveUsage.input > 0 || liveUsage.output > 0) && (
        <div
          className="live-usage"
          title={`Usage for this response — ${formatTokens(
            liveUsage.input,
          )} tokens read, ${formatTokens(
            liveUsage.output,
          )} tokens written. Tokens are the unit AI models bill in.`}
        >
          <span className="live-usage-dot" />
          <span>
            Usage so far · <strong>{formatTokens(liveUsage.input)}</strong> in ·{" "}
            <strong>{formatTokens(liveUsage.output)}</strong> out
          </span>
        </div>
      )}

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

      <div
        className={`composer${dragging ? " dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="field">
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={busy || uploading || !project || !connected}
            placeholder={
              busy
                ? "Uniqus is running…"
                : !connected
                ? "Reconnecting…"
                : project
                ? "Describe what you want Uniqus to build…"
                : "Connecting…"
            }
            rows={2}
            style={{ resize: "none", overflowY: "hidden" }}
          />
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading || !project}
              className="attach-btn"
              title="Attach files to this agent turn"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7l-9.9 9.9a2 2 0 0 1-2.8-2.8l9.4-9.4" />
              </svg>
              Files
            </button>
            <button
              type="button"
              onClick={() =>
                setModeManual(mode === "plan-then-execute" ? "execute-only" : "plan-then-execute")
              }
              className={`plan-toggle ${mode === "plan-then-execute" ? "on" : ""}`}
              title="Plan mode — Uniqus proposes a plan you can edit before it executes. On by default for a brand-new project's first turn."
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Plan
            </button>
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
  /** Hand a failed tool's error back to the agent with a "fix it" prompt. */
  onFixError: (name: string, result: string) => void;
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
      return `${it.id}:${it.result === undefined ? "p" : it.is_error ? "e" : "r"}:${it.lines_added ?? ""}/${it.lines_removed ?? ""}`;
    case "user_question":
      return `${it.id}:${it.answer ?? ""}`;
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
          onSuggestion={handlers.onEdit}
          showSuggestions={isLastTurn && handlers.canAct}
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
    return <ToolCard item={item} onFixError={handlers.onFixError} canAct={handlers.canAct} />;
  }
  if (item.kind === "user_question") {
    return <UserQuestionCard item={item} />;
  }
  if (item.kind === "plan_proposal") {
    return <PlanReview item={item} />;
  }
  if (item.kind === "system") {
    return <div className="msg-system">{item.content}</div>;
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
  onSuggestion,
  showSuggestions,
}: {
  item: Extract<ChatItem, { kind: "complete" }>;
  expanded: boolean;
  onToggle?: () => void;
  onRegenerate?: () => void;
  /** Drop a suggested follow-up into the composer (C2). */
  onSuggestion?: (text: string) => void;
  /** Only the last, actionable turn shows suggestion chips. */
  showSuggestions?: boolean;
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
    parts.push(
      `${formatTokens(item.input_tokens ?? 0)} in · ${formatTokens(item.output_tokens ?? 0)} out`,
    );
  }
  // Per-run cost estimate (C5). "est." kept deliberately — there's no billing
  // system; this is a best-effort number, not a charge.
  if (item.cost_usd !== undefined && item.cost_usd > 0) {
    parts.push(`≈ ${formatCost(item.cost_usd)} est.`);
  }
  const summary = parts.join(" · ");
  const changed = item.changed_files ?? [];
  const suggestions = item.suggestions ?? [];
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

      {/* Suggested next prompts (C2) — drop into composer, never auto-send. */}
      {showSuggestions && suggestions.length > 0 && onSuggestion && (
        <div className="followups">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="followup-chip"
              onClick={() => onSuggestion(s)}
              title="Put this in the composer"
            >
              {s}
            </button>
          ))}
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
  const startRef = useRef<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  useEffect(() => {
    if (isLive && startRef.current === null) startRef.current = Date.now();
    if (!isLive && startRef.current !== null && durationMs === null) {
      setDurationMs(Date.now() - startRef.current);
    }
  }, [isLive, durationMs]);

  useEffect(() => {
    if (!isLive) setExpanded(false);
  }, [isLive]);

  const label = isLive
    ? "Thinking…"
    : durationMs !== null && durationMs >= 1000
    ? `Thought for ${Math.round(durationMs / 1000)}s`
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
 * verb + object so the chat reads as a sentence ("Wrote `index.html`", "Ran
 * `npm install`", "Searched the web for …") instead of a raw `write_file` name.
 * `mono` styles the object as code (paths, commands, patterns). The raw tool
 * name is still surfaced via the card's `data-tool`/`title` for power users.
 */
function describeTool(
  name: string,
  input: unknown,
): { verb: string; object?: string; mono?: boolean } {
  const a = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const path = str(a.path);
  switch (name) {
    case "write_file":
      return { verb: "Wrote", object: path, mono: true };
    case "edit_file":
      return { verb: "Edited", object: path, mono: true };
    case "read_file":
      return { verb: "Read", object: path, mono: true };
    case "list_dir":
      return { verb: "Listed", object: path || "the project", mono: !!path };
    case "grep":
      return { verb: "Searched for", object: str(a.pattern), mono: true };
    case "run_command":
      return { verb: "Ran", object: str(a.command), mono: true };
    case "web_search":
      return { verb: "Searched the web for", object: str(a.query) ? `"${str(a.query)}"` : "" };
    case "start_server":
      return { verb: "Started the app", object: a.port ? `on :${a.port}` : "" };
    case "stop_server":
      return { verb: "Stopped the app" };
    case "list_servers":
      return { verb: "Checked running servers" };
    case "read_server_log":
      return { verb: "Read the server log" };
    case "wait_for_port":
      return { verb: "Waited for", object: a.port ? `port ${a.port}` : "the server" };
    case "screenshot_preview":
      return { verb: "Checked the UI" };
    case "read_asset":
      return { verb: "Viewed", object: path || "an asset", mono: !!path };
    case "list_assets":
      return { verb: "Listed assets" };
    case "todo_write":
      return { verb: "Updated the task list" };
    case "ask_user":
      return { verb: "Asked you", object: str(a.question) };
    default: {
      // snake_case → "Verbed object" fallback so a new/unknown tool still reads
      // as a phrase: "run_migration" → "Run migration".
      const verb = name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      const first = a.path ?? a.url ?? a.query ?? a.command ?? a.name ?? a.pattern ?? a.id ?? a.server_id;
      const object =
        typeof first === "string" || typeof first === "number" ? String(first) : undefined;
      return { verb, object, mono: object !== undefined };
    }
  }
}

function ToolCard({
  item,
  onFixError,
  canAct,
}: {
  item: Extract<ChatItem, { kind: "tool" }>;
  onFixError: (name: string, result: string) => void;
  canAct: boolean;
}) {
  const isError = item.is_error === true;
  // Auto-expand errors so the reason is visible without a click (§C).
  const [expanded, setExpanded] = useState(isError);
  const desc = describeTool(item.name, item.input);
  const hasResult = item.result !== undefined;
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
      {isError && hasResult && (
        <button
          type="button"
          className="tool-fix-btn"
          disabled={!canAct}
          title={
            canAct
              ? "Send this error back to the agent to diagnose and fix"
              : "Available once the agent is idle and connected"
          }
          onClick={() => onFixError(item.name, item.result ?? "")}
        >
          Fix this →
        </button>
      )}
    </>
  );
}

