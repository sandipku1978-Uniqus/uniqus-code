#!/usr/bin/env node
/**
 * Brand image generator (Gemini). Writes a PNG for a text prompt.
 *
 *   node scripts/gen-image.mjs --out apps/web/public/brand/foo.png \
 *     --aspect 16:9 --prompt "..."
 *
 * Reserved for imagery that CSS cannot fake — atmospheric light, volumetric
 * haze, complex multi-stop gradients. Flat shapes, marks and UI stay in code.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function loadKey() {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const m = env.match(/^GOOGLE_API_KEY=(.+)$/m) || env.match(/^GEMINI_API_KEY=(.+)$/m);
  if (!m) throw new Error("GOOGLE_API_KEY not found in .env.local");
  return m[1].trim();
}

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const out = arg("out");
const prompt = arg("prompt");
const aspect = arg("aspect", "16:9");
const model = arg("model", "gemini-3-pro-image");
if (!out || !prompt) {
  console.error("usage: gen-image.mjs --out <path.png> --prompt <text> [--aspect 16:9] [--model ...]");
  process.exit(2);
}

const key = loadKey();
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: aspect },
      },
    }),
  },
);

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const json = await res.json();
const parts = json?.candidates?.[0]?.content?.parts ?? [];
const image = parts.find((p) => p.inlineData?.data);
if (!image) {
  console.error("no image in response:", JSON.stringify(json).slice(0, 900));
  process.exit(1);
}

const dest = resolve(ROOT, out);
mkdirSync(dirname(dest), { recursive: true });
const buf = Buffer.from(image.inlineData.data, "base64");
writeFileSync(dest, buf);
console.log(`wrote ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
