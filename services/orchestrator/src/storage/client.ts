import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "project_files";

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
  if (buckets?.some((b) => b.name === BUCKET)) return;
  const { error } = await storage().storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`createBucket failed: ${error.message}`);
  }
}

export async function upload(
  projectId: string,
  relPath: string,
  content: Buffer,
): Promise<void> {
  const { error } = await storage()
    .storage.from(BUCKET)
    .upload(`${projectId}/${relPath}`, content, { upsert: true });
  if (error) throw new Error(`upload ${relPath}: ${error.message}`);
}

export async function download(
  projectId: string,
  relPath: string,
): Promise<Buffer | null> {
  const { data, error } = await storage()
    .storage.from(BUCKET)
    .download(`${projectId}/${relPath}`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function remove(projectId: string, relPaths: string[]): Promise<void> {
  if (relPaths.length === 0) return;
  const { error } = await storage()
    .storage.from(BUCKET)
    .remove(relPaths.map((p) => `${projectId}/${p}`));
  if (error) throw new Error(`remove: ${error.message}`);
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

  async function walk(prefix: string): Promise<void> {
    const { data, error } = await storage()
      .storage.from(BUCKET)
      .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const fullPath = `${prefix}/${item.name}`;
      if (item.id === null) {
        // folder
        await walk(fullPath);
      } else {
        collected.push(fullPath.slice(projectId.length + 1));
      }
    }
  }

  await walk(projectId);
  return collected;
}
