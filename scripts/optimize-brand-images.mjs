#!/usr/bin/env node
/**
 * Re-encode the generated atmosphere plates for the web.
 *
 * Gemini returns ~700 KB PNGs. These are dark, hazy backdrops that sit at low
 * opacity behind copy — they do not need lossless encoding or 2K+ pixels, and a
 * 750 KB background-image on the dashboard hero is a real cost on a surface that
 * is already the app's most-visited page.
 *
 * WebP at q78 holds smooth gradients without the banding a palette-quantised PNG
 * would introduce, at roughly a tenth of the bytes.
 */
import sharp from "sharp";
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const DIR = resolve(import.meta.dirname, "..", "apps/web/public/brand");

// Max width per plate. These are backdrops, not hero photography — they are
// scaled to cover a band and blurred behind a scrim, so extra pixels are waste.
const MAX_WIDTH = {
  "atmos-hero.png": 2000, // full-bleed 21:9 band
  "atmos-cta.png": 1600,
  "atmos-dash.png": 1600,
  "atmos-auth.png": 1200, // a side panel, never full width
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

let before = 0;
let after = 0;

for (const file of await readdir(DIR)) {
  if (!file.startsWith("atmos-") || !file.endsWith(".png")) continue;

  const src = join(DIR, file);
  const dest = src.replace(/\.png$/, ".webp");
  const srcBytes = (await stat(src)).size;

  const img = sharp(src);
  const { width, height } = await img.metadata();
  const max = MAX_WIDTH[file] ?? 1600;

  const info = await img
    .resize({ width: Math.min(width, max), withoutEnlargement: true })
    .webp({ quality: 78, effort: 6 })
    .toFile(dest);

  before += srcBytes;
  after += info.size;
  console.log(
    `${file}  ${width}×${height} ${kb(srcBytes)}  →  ` +
      `${file.replace(/\.png$/, ".webp")}  ${info.width}×${info.height} ${kb(info.size)}` +
      `  (−${(100 - (info.size / srcBytes) * 100).toFixed(0)}%)`,
  );
}

console.log(`\ntotal: ${kb(before)} → ${kb(after)}  (−${(100 - (after / before) * 100).toFixed(0)}%)`);
console.log("The .png originals are kept as source; CSS should reference the .webp.");
