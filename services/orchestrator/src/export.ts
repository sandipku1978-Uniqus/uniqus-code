import { promises as fs } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { SKIP_DIR_NAMES, SKIP_FILE_BASENAMES } from "./deploy.js";

// Total uncompressed cap so a runaway sandbox can't produce a gigabyte zip.
// Matches the import + deploy caps (200 MB).
const TOTAL_SIZE_CAP = 200 * 1024 * 1024;

/**
 * Build a .zip of a project's sandbox for the "Download .zip" handoff (E2).
 * Reuses the deploy exclusion set (no node_modules / .next / .git / .env*) so
 * the archive is the user's source, not build artifacts or secrets. Throws if
 * the cumulative size exceeds the cap.
 */
export async function buildProjectZip(rootDir: string): Promise<Buffer> {
  const zip = new AdmZip();
  let totalBytes = 0;

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip secret .env family + known junk files.
      if (SKIP_FILE_BASENAMES.has(e.name)) continue;
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        await visit(path.join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      const full = path.join(dir, e.name);
      const data = await fs.readFile(full);
      totalBytes += data.length;
      if (totalBytes > TOTAL_SIZE_CAP) {
        throw new Error(`export exceeds ${TOTAL_SIZE_CAP / 1024 / 1024} MB cap`);
      }
      const rel = path.relative(rootDir, full).replaceAll(path.sep, "/");
      zip.addFile(rel, data);
    }
  }

  await visit(rootDir);
  return zip.toBuffer();
}
