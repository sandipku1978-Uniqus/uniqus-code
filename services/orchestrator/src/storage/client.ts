import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "project_files";

/**
 * Supabase Storage rejects keys containing characters outside its
 * "InvalidKey"-allowed set — notably brackets `[ ]` (Next.js dynamic
 * route folders like `app/[slug]/page.tsx`), `?`, `#`, ` `, etc.
 *
 * Encode each path segment with encodeURIComponent. Slashes stay as
 * separators. Dots/dashes/underscores are unaffected. Reverse with
 * decodePath when reading from the bucket.
 */
function encodePath(relPath: string): string {
  return relPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function decodePath(stored: string): string {
  return stored.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join("/");
}

let client: SupabaseClient | null = null;

function storage(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

/**
 * Idempotent: creates the bucket on first run, no-op on subsequent runs.
 * Called once during orchestrator startup.
 */
export async function ensureBucket(): Promise<void> {
  const { data: buckets, error: listErr } = await storage().storage.listBuckets();
  if (listErr) throw new Error(`listBuckets failed: ${listErr.message}`);
  const existing = buckets?.find((bucket) => bucket.name === BUCKET);
  if (existing) {
    if (existing.public !== false) {
      throw new Error(`storage bucket ${BUCKET} must be private`);
    }
    return;
  }
  const { error } = await storage().storage.createBucket(BUCKET, { public: false });
  if (!error) return;
  if (!/already exists/i.test(error.message)) {
    throw new Error(`createBucket failed: ${error.message}`);
  }
  // A concurrent creator won the race. Re-read instead of treating
  // "already exists" as proof that the bucket has the required privacy.
  const { data: racedBuckets, error: racedListErr } = await storage().storage.listBuckets();
  if (racedListErr) throw new Error(`listBuckets after create race failed: ${racedListErr.message}`);
  const raced = racedBuckets?.find((bucket) => bucket.name === BUCKET);
  if (!raced || raced.public !== false) {
    throw new Error(`storage bucket ${BUCKET} must exist and be private`);
  }
}

export async function upload(
  projectId: string,
  relPath: string,
  content: Buffer,
): Promise<void> {
  const { error } = await storage()
    .storage.from(BUCKET)
    .upload(`${projectId}/${encodePath(relPath)}`, content, { upsert: true });
  if (error) throw new Error(`upload ${relPath}: ${error.message}`);
}

export async function download(
  projectId: string,
  relPath: string,
): Promise<Buffer | null> {
  const { data, error } = await storage()
    .storage.from(BUCKET)
    .download(`${projectId}/${encodePath(relPath)}`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function remove(projectId: string, relPaths: string[]): Promise<void> {
  if (relPaths.length === 0) return;
  const { error } = await storage()
    .storage.from(BUCKET)
    .remove(relPaths.map((p) => `${projectId}/${encodePath(p)}`));
  if (error) throw new Error(`remove: ${error.message}`);
}

// ── Account-scoped objects (not tied to a project) ───────────────────────────
// Used by the account-level Knowledge library, whose raw files live outside any
// single project sandbox. `key` is a full bucket-relative path (each segment is
// URL-encoded the same way as project files), e.g. "knowledge/<userId>/<id>-x.pdf".

export async function uploadObject(key: string, content: Buffer): Promise<void> {
  const { error } = await storage()
    .storage.from(BUCKET)
    .upload(encodePath(key), content, { upsert: true });
  if (error) throw new Error(`uploadObject ${key}: ${error.message}`);
}

export async function downloadObject(key: string): Promise<Buffer | null> {
  const { data, error } = await storage().storage.from(BUCKET).download(encodePath(key));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function removeObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { error } = await storage()
    .storage.from(BUCKET)
    .remove(keys.map((k) => encodePath(k)));
  if (error) throw new Error(`removeObjects: ${error.message}`);
}

/**
 * Recursively list every file under projectId/. Returns paths relative to the
 * project (no leading projectId/).
 *
 * Supabase Storage list() returns one level at a time and signals folders
 * with `id === null`, so we have to walk.
 */
export async function listAll(projectId: string): Promise<string[]> {
  const collected: string[] = [];
  const pageSize = 1000;

  async function walk(prefix: string): Promise<void> {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await storage()
        .storage.from(BUCKET)
        .list(prefix, {
          limit: pageSize,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      if (error) throw new Error(`list ${prefix}: ${error.message}`);
      const page = data ?? [];
      for (const item of page) {
        const fullPath = `${prefix}/${item.name}`;
        if (item.id === null) {
          // folder
          await walk(fullPath);
        } else {
          // Decode the encoded segments back to the user-facing path
          // (so callers see app/[slug]/page.tsx, not app/%5Bslug%5D/page.tsx).
          collected.push(decodePath(fullPath.slice(projectId.length + 1)));
        }
      }
      if (page.length < pageSize) break;
    }
  }

  await walk(projectId);
  return collected;
}
