import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { writeFileBinary, type Sandbox } from "./sandbox.js";

/**
 * `generate_image` — raster image generation + editing with Google's "Nano
 * Banana" models (verified model ids against ai.google.dev/gemini-api/docs/
 * image-generation). The agent calls this to produce real hero images, logos,
 * illustrations, backgrounds, icons, OG images, or product mockups (instead of
 * placeholder boxes), and to EDIT an existing project image (image-to-image).
 *
 * Output is saved under `assets/generated/` in the sandbox and the path is
 * handed back so the agent references it from the app's code (e.g. copies it
 * into `public/`). Image output is billed per image, so the caller records an
 * estimated cost as its own usage event (see loop.ts dispatch).
 */

const IMG_DIR = "assets/generated";

/** Friendly name → Gemini image model id. */
const MODEL_IDS: Record<string, string> = {
  // Nano Banana 2 — Gemini 3.1 Flash Image: fast, high-volume (default).
  "nano-banana-2": "gemini-3.1-flash-image-preview",
  // Nano Banana Pro — Gemini 3 Pro Image: reasoning ("Thinking"), best fidelity
  // + in-image text rendering, higher cost.
  "nano-banana-pro": "gemini-3-pro-image-preview",
  // Nano Banana — Gemini 2.5 Flash Image (the original).
  "nano-banana": "gemini-2.5-flash-image",
};
const DEFAULT_MODEL = "nano-banana-2";

/**
 * Practical per-image USD estimates for the usage dashboard. Image output is
 * actually billed by output tokens at the image rate; these are per-image
 * approximations (Pro renders larger by default, so it's pricier) — an estimate,
 * NOT an exact invoice.
 */
const PER_IMAGE_USD: Record<string, number> = {
  "gemini-3.1-flash-image-preview": 0.04,
  "gemini-3-pro-image-preview": 0.13,
  "gemini-2.5-flash-image": 0.039,
};

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export interface GenerateImageOpts {
  apiKey: string;
  sandbox: Sandbox;
  prompt: string;
  /** Friendly name (nano-banana-2 | nano-banana-pro | nano-banana) or a raw id. */
  model?: string;
  /** "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9" — applied via the prompt. */
  aspectRatio?: string;
  /** Sandbox-relative path to an image to EDIT (image-to-image). */
  inputImagePath?: string;
}

export interface GeneratedImage {
  asset_path: string;
  mime: string;
}

export interface GenerateImageResult {
  images: GeneratedImage[];
  model: string;
  estimated_cost_usd: number;
  note?: string;
}

function resolveModelId(m?: string): string {
  if (!m) return MODEL_IDS[DEFAULT_MODEL];
  const key = m.trim().toLowerCase();
  if (MODEL_IDS[key]) return MODEL_IDS[key];
  // Accept a raw gemini-*-image* id passed straight through.
  if (/^gemini[\w.-]*image/i.test(m.trim())) return m.trim();
  return MODEL_IDS[DEFAULT_MODEL];
}

export async function generateImage(opts: GenerateImageOpts): Promise<GenerateImageResult> {
  if (!opts.apiKey) {
    throw new Error(
      "generate_image needs a Google API key — set GOOGLE_API_KEY (or GEMINI_API_KEY) on the server, or add a Google key in Settings.",
    );
  }
  let prompt = (opts.prompt ?? "").trim();
  if (!prompt) throw new Error("generate_image requires a non-empty 'prompt'");
  // Aspect ratio is applied via the prompt (robust across model versions).
  if (opts.aspectRatio && /^\d{1,2}:\d{1,2}$/.test(opts.aspectRatio.trim())) {
    prompt += `\n\nRender at a ${opts.aspectRatio.trim()} aspect ratio.`;
  }
  const modelId = resolveModelId(opts.model);

  // Build request contents: the instruction, plus the source image when editing.
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];
  if (opts.inputImagePath) {
    const root = path.resolve(opts.sandbox.rootDir);
    const abs = path.resolve(root, opts.inputImagePath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error("input_image must be a path inside the project");
    }
    const buf = await fs.readFile(abs).catch(() => {
      throw new Error(`input_image not found: ${opts.inputImagePath}`);
    });
    const ext = path.extname(opts.inputImagePath).slice(1).toLowerCase();
    parts.push({
      inlineData: { mimeType: MIME_BY_EXT[ext] ?? "image/png", data: buf.toString("base64") },
    });
  }

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  let resp;
  try {
    resp = await ai.models.generateContent({ model: modelId, contents: parts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|404|unsupported|not available|permission|403/i.test(msg)) {
      throw new Error(
        `Image model "${modelId}" isn't available on this key/region (${msg.slice(0, 160)}). Try model:"nano-banana" (Gemini 2.5 Flash Image), or check that the Gemini image models are enabled for your key.`,
      );
    }
    throw new Error(`generate_image failed: ${msg.slice(0, 240)}`);
  }

  const respParts = resp.candidates?.[0]?.content?.parts ?? [];
  const images: GeneratedImage[] = [];
  let note = "";
  const runPrefix = randomUUID().slice(0, 8);
  for (const p of respParts) {
    if (p.text) {
      note += p.text;
      continue;
    }
    const data = p.inlineData?.data;
    if (!data) continue;
    const mime = p.inlineData?.mimeType ?? "image/png";
    const ext = EXT_BY_MIME[mime] ?? "png";
    const rel = `${IMG_DIR}/${runPrefix}-${images.length}.${ext}`;
    // Write through the sandbox so the file lands in the VM (where the dev server
    // serves it) AND the host mirror (file tree / storage sync), not just host.
    await writeFileBinary(opts.sandbox, rel, Buffer.from(data, "base64"));
    images.push({ asset_path: rel, mime });
  }

  if (images.length === 0) {
    throw new Error(
      note.trim()
        ? `The model returned no image — it replied: ${note.trim().slice(0, 300)}`
        : "The model returned no image data (the prompt may have been refused, or the model is unavailable on your key).",
    );
  }

  return {
    images,
    model: modelId,
    estimated_cost_usd: (PER_IMAGE_USD[modelId] ?? 0.04) * images.length,
    note: note.trim() || undefined,
  };
}
