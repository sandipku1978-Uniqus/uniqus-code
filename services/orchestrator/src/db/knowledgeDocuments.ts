import { db } from "./client.js";
import type { KnowledgeDocument } from "@uniqus/api-types";

/**
 * Account-level Knowledge documents. Each row is a file the user uploaded once
 * (regulation, research paper, dataset, spec, …) that the agent can reference
 * across ALL of their projects via the `knowledge_search` tool. The raw file
 * lives in object storage (`storage_path`); the extracted plain text lives in
 * `content` and powers search. All reads/writes are user-scoped — a user only
 * ever sees and edits their own documents. Mirrors db/skillLibraries.ts.
 */

// `content` is deliberately excluded from list/metadata reads — it can be large
// and the list view never needs the full text.
const META_COLS =
  "id, title, description, file_name, mime_type, size_bytes, char_count, extracted, created_at, updated_at";

function rowToDoc(row: Record<string, unknown>): KnowledgeDocument {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    file_name: row.file_name as string,
    mime_type: (row.mime_type as string | null) ?? "application/octet-stream",
    size_bytes: Number(row.size_bytes ?? 0),
    char_count: Number(row.char_count ?? 0),
    extracted: Boolean(row.extracted),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function listKnowledgeDocuments(userId: string): Promise<KnowledgeDocument[]> {
  const { data, error } = await db()
    .from("knowledge_documents")
    .select(META_COLS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listKnowledgeDocuments failed: ${error.message}`);
  return (data ?? []).map((r) => rowToDoc(r as Record<string, unknown>));
}

/** Metadata only — for the workspace turn that advertises the library to the agent. */
export async function listKnowledgeDocumentTitles(
  userId: string,
): Promise<{ id: string; title: string; description: string | null }[]> {
  const { data, error } = await db()
    .from("knowledge_documents")
    .select("id, title, description")
    .eq("user_id", userId)
    .eq("extracted", true)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`listKnowledgeDocumentTitles failed: ${error.message}`);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
    };
  });
}

/** Full document incl. extracted text (for the detail/preview view). */
export async function getKnowledgeDocument(
  userId: string,
  id: string,
): Promise<{ document: KnowledgeDocument; content: string; storage_path: string } | null> {
  const { data, error } = await db()
    .from("knowledge_documents")
    .select(`${META_COLS}, content, storage_path`)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getKnowledgeDocument failed: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    document: rowToDoc(row),
    content: (row.content as string | null) ?? "",
    storage_path: row.storage_path as string,
  };
}

export async function createKnowledgeDocument(
  userId: string,
  input: {
    title: string;
    description?: string | null;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    content: string;
    extracted: boolean;
  },
): Promise<KnowledgeDocument> {
  const { data, error } = await db()
    .from("knowledge_documents")
    .insert({
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      file_name: input.file_name,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      storage_path: input.storage_path,
      content: input.content,
      char_count: input.content.length,
      extracted: input.extracted,
    })
    .select(META_COLS)
    .single();
  if (error || !data) throw new Error(`createKnowledgeDocument failed: ${error?.message}`);
  return rowToDoc(data as Record<string, unknown>);
}

export async function updateKnowledgeDocument(
  userId: string,
  id: string,
  patch: { title?: string; description?: string | null },
): Promise<KnowledgeDocument | null> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (Object.keys(update).length === 0) {
    const existing = await getKnowledgeDocument(userId, id);
    return existing?.document ?? null;
  }
  const { data, error } = await db()
    .from("knowledge_documents")
    .update(update)
    .eq("user_id", userId)
    .eq("id", id)
    .select(META_COLS)
    .maybeSingle();
  if (error) throw new Error(`updateKnowledgeDocument failed: ${error.message}`);
  return data ? rowToDoc(data as Record<string, unknown>) : null;
}

export async function deleteKnowledgeDocument(userId: string, id: string): Promise<void> {
  const { error } = await db()
    .from("knowledge_documents")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`deleteKnowledgeDocument failed: ${error.message}`);
}

// ── Search (powers the knowledge_search agent tool) ──────────────────────────

export interface KnowledgeSearchHit {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  /** Best-matching excerpt(s) with the query terms in context. */
  snippet: string;
  /** Relevance score (term hits, weighted toward title matches). */
  score: number;
}

/** Window of text around the first occurrence of any query term. */
function buildSnippet(content: string, terms: string[], radius = 280): string {
  const lower = content.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) {
    // No literal term hit (e.g. matched on title) — return the head.
    return content.slice(0, radius * 2).trim();
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(content.length, at + radius);
  const prefix = start > 0 ? "… " : "";
  const suffix = end < content.length ? " …" : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

/** Tokenize a query into distinct lowercase terms for scoring + snippet windows. */
function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  );
}

/** Score + snippet a candidate row that Postgres already deemed a match. */
function scoreRow(row: Record<string, unknown>, terms: string[]): KnowledgeSearchHit {
  const content = (row.content as string | null) ?? "";
  const haystack = content.toLowerCase();
  const title = (row.title as string) ?? "";
  const titleLower = title.toLowerCase();
  // Base score 1: the row is a confirmed DB match (FTS handles stemming, so the
  // exact term may not appear literally) — never drop a real match to 0.
  let score = 1;
  for (const t of terms) {
    if (titleLower.includes(t)) score += 5;
    let from = 0;
    let hits = 0;
    for (;;) {
      const i = haystack.indexOf(t, from);
      if (i < 0 || hits >= 25) break;
      hits++;
      from = i + t.length;
    }
    score += hits;
  }
  return {
    id: row.id as string,
    title,
    description: (row.description as string | null) ?? null,
    file_name: (row.file_name as string) ?? "",
    snippet: buildSnippet(content, terms),
    score,
  };
}

/**
 * Keyword search across the user's Knowledge documents. The candidate filter is
 * pushed into Postgres (full-text on the GIN-indexed `content_fts`, falling back
 * to server-side ILIKE) so only MATCHING rows' bodies leave the DB — never the
 * whole library — and documents past the first N-by-recency are still reachable.
 * Matched rows are then scored + excerpted in Node. A future upgrade can swap the
 * candidate filter for embeddings without changing the tool surface.
 */
export async function searchKnowledgeDocuments(
  userId: string,
  query: string,
  opts: { limit?: number } = {},
): Promise<KnowledgeSearchHit[]> {
  const limit = opts.limit ?? 5;
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  // Cap candidate rows pulled for scoring — FTS already narrowed to matches, so
  // this is a safety bound on a single pathological query, not a library cap.
  const CANDIDATES = 50;
  const cols = "id, title, description, file_name, content";

  let rows: Record<string, unknown>[] = [];
  // Primary: Postgres full-text search (stemmed, GIN-indexed).
  const fts = await db()
    .from("knowledge_documents")
    .select(cols)
    .eq("user_id", userId)
    .eq("extracted", true)
    .textSearch("content_fts", query, { type: "websearch", config: "english" })
    .limit(CANDIDATES);
  if (fts.error) {
    // Fallback (e.g. the generated column isn't present yet): a server-side
    // ILIKE OR-filter still transfers only matching rows. terms are
    // alphanumeric (tokenizer-stripped), so they're safe in the filter string.
    const orFilter = terms
      .flatMap((t) => [`title.ilike.*${t}*`, `content.ilike.*${t}*`])
      .join(",");
    const like = await db()
      .from("knowledge_documents")
      .select(cols)
      .eq("user_id", userId)
      .eq("extracted", true)
      .or(orFilter)
      .limit(CANDIDATES);
    if (like.error) throw new Error(`searchKnowledgeDocuments failed: ${like.error.message}`);
    rows = (like.data ?? []) as Record<string, unknown>[];
  } else {
    rows = (fts.data ?? []) as Record<string, unknown>[];
  }

  const scored = rows.map((r) => scoreRow(r, terms));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
