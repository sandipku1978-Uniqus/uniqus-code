/**
 * Agent-maintained todo list (Plan §5 — "Artifact panes UI").
 *
 * The agent uses `todo_write` to declare and update a structured task list
 * for the current request. The UI surfaces it in a dedicated pane (rather
 * than buried inline in chat) so the user can always see what's planned,
 * what's in flight, and what's blocked.
 *
 * Storage is in-memory and per-project. Survives across turns within the
 * orchestrator process so the agent can carry tasks from one user message
 * to the next; cleared on session reset and on orchestrator restart.
 */

export interface TodoItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

const lists = new Map<string, TodoItem[]>();

export function setTodos(projectId: string, items: TodoItem[]): TodoItem[] {
  // Defensive normalization — the agent occasionally drops or mistypes
  // fields. Anything unrecognized in `status` falls back to "pending".
  const normalized: TodoItem[] = items.map((it) => ({
    content: String(it.content ?? "").trim() || "(unnamed)",
    activeForm: String(it.activeForm ?? "").trim() || String(it.content ?? ""),
    status: (it.status === "in_progress" || it.status === "completed"
      ? it.status
      : "pending") as TodoItem["status"],
  }));
  lists.set(projectId, normalized);
  return normalized;
}

export function getTodos(projectId: string): TodoItem[] {
  return lists.get(projectId) ?? [];
}

export function clearTodos(projectId: string): void {
  lists.delete(projectId);
}
