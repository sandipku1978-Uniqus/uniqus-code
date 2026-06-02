/**
 * Agent-maintained todo list (Plan §5 — "Artifact panes UI").
 *
 * The agent uses `todo_write` to declare and update a structured task list
 * for the current request. The UI surfaces it in a dedicated pane (rather
 * than buried inline in chat) so the user can always see what's planned,
 * what's in flight, and what's blocked.
 *
 * Storage is in-memory and keyed per (project, chat session). Survives across
 * turns within the orchestrator process so the agent can carry tasks from one
 * user message to the next; cleared on session reset and on orchestrator
 * restart. Keying by session (not just project) keeps two chat sessions in the
 * same project from showing each other's todos (B-11).
 */

export interface TodoItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

const lists = new Map<string, TodoItem[]>();

/** Composite key so sibling chat sessions in one project don't share a list. */
function key(projectId: string, sessionId: string | null): string {
  return `${projectId}:${sessionId ?? ""}`;
}

export function setTodos(
  projectId: string,
  sessionId: string | null,
  items: TodoItem[],
): TodoItem[] {
  // Defensive normalization — the agent occasionally drops or mistypes
  // fields. Anything unrecognized in `status` falls back to "pending".
  const normalized: TodoItem[] = items.map((it) => ({
    content: String(it.content ?? "").trim() || "(unnamed)",
    activeForm: String(it.activeForm ?? "").trim() || String(it.content ?? ""),
    status: (it.status === "in_progress" || it.status === "completed"
      ? it.status
      : "pending") as TodoItem["status"],
  }));
  lists.set(key(projectId, sessionId), normalized);
  return normalized;
}

export function getTodos(projectId: string, sessionId: string | null): TodoItem[] {
  return lists.get(key(projectId, sessionId)) ?? [];
}

export function clearTodos(projectId: string, sessionId: string | null): void {
  lists.delete(key(projectId, sessionId));
}
