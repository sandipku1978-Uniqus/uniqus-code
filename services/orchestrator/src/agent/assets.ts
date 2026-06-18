import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Per-project assets (Plan §3.8).
 *
 * "Assets" are user-provided reference material that flows into the agent's
 * context but is distinct from project_files — design guides, screenshots,
 * sample CSVs, brand logos, mockups, etc. They live under
 * `<sandbox>/assets/uploads/` so they're version-tracked and visible in the
 * file tree, but the dedicated `list_assets` / `read_asset` tools give the
 * agent a clear contract to discover and use them without confusing them
 * for source files (e.g. a CSV is reference data, not a script to execute).
 *
 * Plan §3.8 mentions a separate Storage bucket for hard isolation. We keep
 * sandbox storage today (matches existing upload flow); the tool surface is
 * stable enough that a future swap to a `project_assets` bucket is internal.
 */

const ASSETS_ROOT = "assets/uploads";
const MAX_TEXT_BYTES = 256 * 1024;

export interface AssetEntry {
  name: string;
  path: string;
  size: number;
  mime_type: string;
}

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".tsv",
  ".yml",
  ".yaml",
  ".xml",
  ".html",
  ".htm",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".css",
  ".log",
  ".sql",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".sh",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

function mimeFromExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".html":
    case ".htm":
      return "text/html";
    default:
      if (TEXT_EXTENSIONS.has(ext)) return "text/plain";
      return "application/octet-stream";
  }
}

export function isImageAsset(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function isTextAsset(name: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export async function listAssets(sandboxDir: string): Promise<AssetEntry[]> {
  const root = path.resolve(sandboxDir, ASSETS_ROOT);
  const sandboxRoot = path.resolve(sandboxDir);
  if (root !== sandboxRoot && !root.startsWith(sandboxRoot + path.sep)) return [];
  let entries: { name: string; path: string }[] = [];
  try {
    const list = await fs.readdir(root, { withFileTypes: true });
    for (const e of list) {
      if (!e.isFile()) continue;
      entries.push({ name: e.name, path: `${ASSETS_ROOT}/${e.name}` });
    }
  } catch {
    return [];
  }
  const out: AssetEntry[] = [];
  for (const entry of entries) {
    try {
      const stat = await fs.stat(path.join(root, entry.name));
      out.push({
        name: entry.name,
        path: entry.path,
        size: stat.size,
        mime_type: mimeFromExt(entry.name),
      });
    } catch {
      // skip — file disappeared between readdir and stat
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function resolveAssetPath(sandboxDir: string, name: string): string {
  const cleaned = name.replace(/^\/+/, "");
  if (path.isAbsolute(cleaned)) {
    throw new Error("asset name must be sandbox-relative");
  }
  // Accept paths from both assets/uploads/ and assets/screenshots/
  const SCREENSHOTS_ROOT = "assets/screenshots";
  let rel: string;
  if (cleaned.startsWith(`${ASSETS_ROOT}/`) || cleaned.startsWith(`${SCREENSHOTS_ROOT}/`)) {
    rel = cleaned;
  } else {
    rel = `${ASSETS_ROOT}/${cleaned}`;
  }
  const full = path.resolve(sandboxDir, rel);
  const uploadsRoot = path.resolve(sandboxDir, ASSETS_ROOT);
  const screenshotsRoot = path.resolve(sandboxDir, SCREENSHOTS_ROOT);
  const inUploads = full === uploadsRoot || full.startsWith(uploadsRoot + path.sep);
  const inScreenshots = full === screenshotsRoot || full.startsWith(screenshotsRoot + path.sep);
  if (!inUploads && !inScreenshots) {
    throw new Error("asset path escapes allowed directories");
  }
  const relParts = rel.split(/[\\/]+/);
  if (relParts.includes("..")) {
    throw new Error(`invalid asset name: ${name}`);
  }
  return full;
}

export async function readAssetText(sandboxDir: string, name: string): Promise<string> {
  const full = resolveAssetPath(sandboxDir, name);
  const stat = await fs.stat(full);
  if (stat.size > MAX_TEXT_BYTES) {
    const buf = await fs.readFile(full);
    return `${buf.subarray(0, MAX_TEXT_BYTES).toString("utf-8")}\n[... truncated ${stat.size - MAX_TEXT_BYTES} bytes ...]`;
  }
  return await fs.readFile(full, "utf-8");
}

export async function readAssetBase64(
  sandboxDir: string,
  name: string,
): Promise<{ base64: string; mime: string }> {
  const full = resolveAssetPath(sandboxDir, name);
  const buf = await fs.readFile(full);
  return { base64: buf.toString("base64"), mime: mimeFromExt(name) };
}

/** Max image size the vision bridge will read (keeps a stray huge file from OOMing). */
const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Read ANY sandbox-relative image for the vision bridge (analyze_image). Unlike
 * readAssetBase64 (uploads/screenshots only), this allows any image path under
 * the sandbox root — screenshots, uploads, generated images, or images the
 * project produced (e.g. public/hero.png) — with a path-traversal guard, an
 * image-extension check, and a size cap. Same trust level as read_file.
 */
export async function readImageBase64(
  sandboxDir: string,
  relPath: string,
): Promise<{ base64: string; mime: string }> {
  const cleaned = relPath.replace(/^\/+/, "");
  if (path.isAbsolute(cleaned)) throw new Error("image path must be sandbox-relative");
  if (cleaned.split(/[\\/]+/).includes("..")) throw new Error(`invalid image path: ${relPath}`);
  const full = path.resolve(sandboxDir, cleaned);
  const root = path.resolve(sandboxDir);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("image path escapes the sandbox");
  }
  if (!isImageAsset(cleaned)) throw new Error(`not an image file: ${relPath}`);
  const stat = await fs.stat(full);
  if (stat.size > MAX_VISION_IMAGE_BYTES) {
    throw new Error(`image too large for the vision model (${stat.size} bytes, max ${MAX_VISION_IMAGE_BYTES})`);
  }
  const buf = await fs.readFile(full);
  return { base64: buf.toString("base64"), mime: mimeFromExt(cleaned) };
}
