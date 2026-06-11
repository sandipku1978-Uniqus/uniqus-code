import { db } from "./client.js";

/**
 * Per-project chat sessions (Phase 2.x).
 *
 * The agent loop is stateless across sessions — switching threads only
 * swaps which historical messages get loaded into the next turn's context.
 * The VM, sandbox files, secrets, skills, and todos all stay project-wide.
 *
 * Backwards compatibility: pre-2.x messages have `session_id IS NULL`.
 * `ensureDefaultSession` is the one entry point that, on first call for a
 * project, creates a "Default" row and stamps every legacy message with it.
 * From then on every read can use a non-null session id.
 */

export interface ChatSessionRecord {
  id: string;
  project_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_TITLE = "Default";

/**
 * Make sure the project has at least one chat session, and that any pre-2.x
 * messages have been migrated into it. Idempotent — safe to call on every
 * read. Returns the resolved default session.
 */
export async function ensureDefaultSession(projectId: string): Promise<ChatSessionRecord> {
  // Cheapest case: one already exists.
  const existing = await loadDefaultSession(projectId);
  if (existing) {
    // Backfill any orphan messages from before the column existed.
    await migrateOrphanMessages(projectId, existing.id);
    return existing;
  }
  // Create the default session. The
  // `chat_sessions_one_default_per_project` partial unique index makes this
  // safe under concurrent connects: the second insert raises 23505, we
  // re-read and return the row the winner just created. Without the catch
  // path, one of two simultaneous WS clients would see a 500.
  const { data: created, error: createErr } = await db()
    .from("chat_sessions")
    .insert({ project_id: projectId, title: DEFAULT_TITLE })
    .select("id, project_id, title, created_at, updated_at")
    .single();
  if (createErr) {
    if (isUniqueViolation(createErr)) {
      const winner = await loadDefaultSession(projectId);
      if (winner) {
        await migrateOrphanMessages(projectId, winner.id);
        return winner;
      }
      // Index says a row exists but we couldn't read it — fall through and
      // surface the original error rather than loop.
    }
    throw new Error(`ensureDefaultSession create failed: ${createErr.message}`);
  }
  if (!created) {
    throw new Error(`ensureDefaultSession create returned no row`);
  }
  const session = created as ChatSessionRecord;
  await migrateOrphanMessages(projectId, session.id);
  return session;
}

/** Read the oldest existing chat session for a project, if any. */
async function loadDefaultSession(projectId: string): Promise<ChatSessionRecord | null> {
  const { data, error } = await db()
    .from("chat_sessions")
    .select("id, project_id, title, created_at, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`ensureDefaultSession lookup failed: ${error.message}`);
  return (data && data.length > 0 ? (data[0] as ChatSessionRecord) : null);
}

/** Postgres unique_violation. Supabase passes the SQLSTATE through verbatim. */
function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return err?.code === "23505";
}

async function migrateOrphanMessages(projectId: string, sessionId: string): Promise<void> {
  // Stamp NULL session_id rows to point at this session. One round trip,
  // no-op if there are none. We don't read the count back — the next
  // loadHistory call will see the migrated rows.
  const { error } = await db()
    .from("messages")
    .update({ session_id: sessionId })
    .eq("project_id", projectId)
    .is("session_id", null);
  if (error) {
    console.error(
      `migrateOrphanMessages(${projectId.slice(0, 8)}) failed (will retry next read):`,
      error.message,
    );
  }
}

export async function listSessions(projectId: string): Promise<ChatSessionRecord[]> {
  // Make sure the default exists so a freshly-imported project always has
  // at least one row to show in the dropdown.
  await ensureDefaultSession(projectId);
  const { data, error } = await db()
    .from("chat_sessions")
    .select("id, project_id, title, created_at, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listSessions failed: ${error.message}`);
  return (data ?? []) as ChatSessionRecord[];
}

export async function getSession(
  projectId: string,
  sessionId: string,
): Promise<ChatSessionRecord | null> {
  const { data, error } = await db()
    .from("chat_sessions")
    .select("id, project_id, title, created_at, updated_at")
    .eq("project_id", projectId)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`getSession failed: ${error.message}`);
  return (data as ChatSessionRecord | null) ?? null;
}

/**
 * "Default" is the auto-managed session title and has a partial unique index
 * (one per project). A user naming/renaming a session "Default" would hit that
 * index and surface as a raw 500 (C-94). Reject it up front with a clear,
 * user-facing message instead. Postgres unique-violation code is also handled
 * defensively in case of a race.
 */
function guardReservedTitle(title: string | null): void {
  if (title?.trim() === "Default") {
    throw new Error('"Default" is reserved — choose a different chat name.');
  }
}

export async function createSession(
  projectId: string,
  title: string | null,
): Promise<ChatSessionRecord> {
  guardReservedTitle(title);
  const { data, error } = await db()
    .from("chat_sessions")
    .insert({ project_id: projectId, title: title?.trim() || null })
    .select("id, project_id, title, created_at, updated_at")
    .single();
  if (isUniqueViolation(error)) {
    throw new Error('A chat with that name already exists — choose a different name.');
  }
  if (error || !data) throw new Error(`createSession failed: ${error?.message}`);
  return data as ChatSessionRecord;
}

export async function renameSession(
  projectId: string,
  sessionId: string,
  title: string,
): Promise<ChatSessionRecord> {
  guardReservedTitle(title);
  const { data, error } = await db()
    .from("chat_sessions")
    .update({ title: title.trim() })
    .eq("project_id", projectId)
    .eq("id", sessionId)
    .select("id, project_id, title, created_at, updated_at")
    .single();
  if (isUniqueViolation(error)) {
    throw new Error('A chat with that name already exists — choose a different name.');
  }
  if (error || !data) throw new Error(`renameSession failed: ${error?.message}`);
  return data as ChatSessionRecord;
}

export async function deleteSession(
  projectId: string,
  sessionId: string,
): Promise<void> {
  const { error } = await db()
    .from("chat_sessions")
    .delete()
    .eq("project_id", projectId)
    .eq("id", sessionId);
  if (error) throw new Error(`deleteSession failed: ${error.message}`);
}

/**
 * Bump updated_at so list ordering stays "freshest first".
 *
 * Throws on failure — callers decide whether to retry, log, or ignore. The
 * one current caller in server.ts retries once then logs prominently, since a
 * silent failure makes recently-active sessions drift to the bottom of the
 * dropdown with no signal to the user.
 */
export async function touchSession(sessionId: string): Promise<void> {
  // Bare update with no-op set is fine — the trigger touches updated_at.
  const { error } = await db()
    .from("chat_sessions")
    .update({})
    .eq("id", sessionId);
  if (error) {
    throw new Error(`touchSession(${sessionId.slice(0, 8)}) failed: ${error.message}`);
  }
}
