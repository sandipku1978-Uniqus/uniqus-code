import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GoogleGenAI, type GenerateContentResponseUsageMetadata } from "@google/genai";
import { writeFileBinary, type Sandbox } from "./sandbox.js";

const IMG_DIR = "assets/generated";
const DEFAULT_MODEL = "nano-banana-2";
const IMAGE_SIZE = "1K";
const IMAGE_MAX_OUTPUT_TOKENS = 4096;
const IMAGE_MAX_INPUT_TOKENS = 131_072;

/** Friendly name -> current stable Gemini image model id. */
const MODEL_IDS: Record<string, string> = {
  "nano-banana-2": "gemini-3.1-flash-image",
  "nano-banana-pro": "gemini-3-pro-image",
  "nano-banana": "gemini-2.5-flash-image",
};

/** Standard-tier list prices verified against ai.google.dev on 2026-07-15. */
const IMAGE_PRICING: Record<
  string,
  {
    inputPerMillion: number;
    textOutputPerMillion: number;
    imageOutputPerMillion: number;
    oneImageUsd: number;
  }
> = {
  "gemini-3.1-flash-image": {
    inputPerMillion: 0.5,
    textOutputPerMillion: 3,
    imageOutputPerMillion: 60,
    oneImageUsd: 0.067,
  },
  "gemini-3-pro-image": {
    inputPerMillion: 2,
    textOutputPerMillion: 12,
    imageOutputPerMillion: 120,
    oneImageUsd: 0.134,
  },
  "gemini-2.5-flash-image": {
    inputPerMillion: 0.3,
    textOutputPerMillion: 2.5,
    imageOutputPerMillion: 30,
    oneImageUsd: 0.039,
  },
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

export interface GenerateImageUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface GenerateImageOpts {
  apiKey: string;
  sandbox: Sandbox;
  prompt: string;
  /** Friendly name (nano-banana-2 | nano-banana-pro | nano-banana) or a raw id. */
  model?: string;
  /** Supported ratios are forwarded through imageConfig; output is fixed at 1K. */
  aspectRatio?: string;
  /** Sandbox-relative path to an image to edit. */
  inputImagePath?: string;
  signal?: AbortSignal;
  /** Called at the exact SDK boundary with this request's conservative ceiling. */
  onProviderStart?: (maxCostUsd: number) => void;
  /** Called before local asset writes once a trustworthy receipt is available. */
  onProviderReceipt?: (costUsd: number, usage: GenerateImageUsage) => void;
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

export function resolveImageModelId(model?: string): string {
  if (!model) return MODEL_IDS[DEFAULT_MODEL]!;
  const key = model.trim().toLowerCase();
  if (MODEL_IDS[key]) return MODEL_IDS[key]!;
  // Raw ids are accepted only when this module has an explicit price contract
  // for them. Passing an unknown image id through while pricing it as Flash
  // would make the platform preflight cheaper than the actual request.
  const stableRawId = Object.values(MODEL_IDS).find(
    (candidate) => candidate.toLowerCase() === key,
  );
  if (stableRawId) return stableRawId;
  throw new Error(
    `Unsupported image model "${model}". Use nano-banana-2, nano-banana-pro, or nano-banana.`,
  );
}

function pricingForModel(model?: string) {
  return IMAGE_PRICING[resolveImageModelId(model)] ?? IMAGE_PRICING[MODEL_IDS[DEFAULT_MODEL]!]!;
}

/**
 * Conservative ceiling for the request below. The highest output-modality rate
 * covers any mix of final image, text, and thinking tokens under the 4,096 cap.
 */
export function estimateImageGenerationCostUsd(
  model?: string,
  estimatedInputTokens = 0,
): number {
  const price = pricingForModel(model);
  return (
    (Math.max(0, Math.ceil(estimatedInputTokens)) * price.inputPerMillion +
      IMAGE_MAX_OUTPUT_TOKENS *
        Math.max(price.textOutputPerMillion, price.imageOutputPerMillion)) /
    1_000_000
  );
}

/** Optional edit images are bounded by the largest allowed model input window. */
export function imageGenerationInputTokenCeiling(prompt: string, inputBytes = 0): number {
  const transportEstimate =
    Buffer.byteLength(prompt, "utf8") + Math.ceil((inputBytes * 4) / 3) + 256;
  return inputBytes > 0
    ? Math.max(transportEstimate, IMAGE_MAX_INPUT_TOKENS)
    : transportEstimate;
}

export function imageGenerationUsageCostUsd(
  model: string,
  usage: GenerateContentResponseUsageMetadata,
  imageCount: number,
): number {
  const price = pricingForModel(model);
  const details = usage.candidatesTokensDetails ?? [];
  let candidateCostUsd: number;
  if (details.length > 0) {
    let detailedTokens = 0;
    let detailedCost = 0;
    for (const detail of details) {
      const tokens = Math.max(0, detail.tokenCount ?? 0);
      detailedTokens += tokens;
      detailedCost +=
        (tokens *
          (String(detail.modality).toUpperCase() === "IMAGE"
            ? price.imageOutputPerMillion
            : price.textOutputPerMillion)) /
        1_000_000;
    }
    const unclassifiedTokens = Math.max(
      0,
      (usage.candidatesTokenCount ?? 0) - detailedTokens,
    );
    candidateCostUsd =
      detailedCost + (unclassifiedTokens * price.textOutputPerMillion) / 1_000_000;
  } else if (imageCount > 0) {
    // Older responses can omit modality detail. The request is fixed to 1K, so
    // use the documented per-image amount; responseModalities excludes text.
    candidateCostUsd = imageCount * price.oneImageUsd;
  } else {
    // Refusals can return text even though IMAGE was requested.
    candidateCostUsd =
      ((usage.candidatesTokenCount ?? 0) * price.textOutputPerMillion) / 1_000_000;
  }
  return (
    ((usage.promptTokenCount ?? 0) * price.inputPerMillion +
      (usage.thoughtsTokenCount ?? 0) * price.textOutputPerMillion) /
      1_000_000 +
    candidateCostUsd
  );
}

export function imageGenerationReceiptUsage(
  usage: GenerateContentResponseUsageMetadata,
): GenerateImageUsage | null {
  const detailedCandidateTokens = (usage.candidatesTokensDetails ?? []).reduce(
    (sum, detail) => sum + Math.max(0, detail.tokenCount ?? 0),
    0,
  );
  const inputTokens = Math.max(0, usage.promptTokenCount ?? 0);
  const outputTokens =
    Math.max(Math.max(0, usage.candidatesTokenCount ?? 0), detailedCandidateTokens) +
    Math.max(0, usage.thoughtsTokenCount ?? 0);
  if (inputTokens === 0 && outputTokens === 0) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

export async function generateImage(opts: GenerateImageOpts): Promise<GenerateImageResult> {
  if (!opts.apiKey) {
    throw new Error(
      "generate_image needs a Google API key — set GOOGLE_API_KEY (or GEMINI_API_KEY) on the server, or add a Google key in Settings.",
    );
  }
  const prompt = (opts.prompt ?? "").trim();
  if (!prompt) throw new Error("generate_image requires a non-empty 'prompt'");
  const modelId = resolveImageModelId(opts.model);
  const aspectRatio =
    opts.aspectRatio && /^\d{1,2}:\d{1,2}$/.test(opts.aspectRatio.trim())
      ? opts.aspectRatio.trim()
      : undefined;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: `${prompt}\n\nReturn exactly one final image.` },
  ];
  let inputBytes = 0;
  if (opts.inputImagePath) {
    const root = path.resolve(opts.sandbox.rootDir);
    const abs = path.resolve(root, opts.inputImagePath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error("input_image must be a path inside the project");
    }
    const buf = await fs.readFile(abs).catch(() => {
      throw new Error(`input_image not found: ${opts.inputImagePath}`);
    });
    inputBytes = buf.length;
    const ext = path.extname(opts.inputImagePath).slice(1).toLowerCase();
    parts.push({
      inlineData: { mimeType: MIME_BY_EXT[ext] ?? "image/png", data: buf.toString("base64") },
    });
  }

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  let resp;
  try {
    // Deliberately overestimates binary input; settlement uses provider tokens.
    const estimatedInputTokens = imageGenerationInputTokenCeiling(prompt, inputBytes);
    opts.onProviderStart?.(estimateImageGenerationCostUsd(modelId, estimatedInputTokens));
    resp = await ai.models.generateContent({
      model: modelId,
      contents: parts,
      config: {
        abortSignal: opts.signal,
        candidateCount: 1,
        maxOutputTokens: IMAGE_MAX_OUTPUT_TOKENS,
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio, imageSize: IMAGE_SIZE },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|404|unsupported|not available|permission|403/i.test(msg)) {
      throw new Error(
        `Image model "${modelId}" isn't available on this key/region (${msg.slice(0, 160)}). Try model:"nano-banana" (Gemini 2.5 Flash Image), or check that Gemini image models are enabled for your key.`,
      );
    }
    throw new Error(`generate_image failed: ${msg.slice(0, 240)}`);
  }

  const responseParts = resp.candidates?.[0]?.content?.parts ?? [];
  const finalImageParts = responseParts.filter(
    (part) => Boolean(part.inlineData?.data) && !part.thought,
  );
  const receiptCostUsd = resp.usageMetadata
    ? imageGenerationUsageCostUsd(modelId, resp.usageMetadata, finalImageParts.length)
    : null;
  const receiptUsage = resp.usageMetadata
    ? imageGenerationReceiptUsage(resp.usageMetadata)
    : null;
  if (receiptUsage && receiptCostUsd !== null) {
    opts.onProviderReceipt?.(receiptCostUsd, receiptUsage);
  }

  const firstImage = finalImageParts[0];
  if (!firstImage?.inlineData?.data) {
    const note = responseParts
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    throw new Error(
      note
        ? `The model returned no image — it replied: ${note.slice(0, 300)}`
        : "The model returned no final image data (the prompt may have been refused).",
    );
  }

  const mime = firstImage.inlineData.mimeType ?? "image/png";
  const ext = EXT_BY_MIME[mime] ?? "png";
  const rel = `${IMG_DIR}/${randomUUID().slice(0, 8)}-0.${ext}`;
  await writeFileBinary(opts.sandbox, rel, Buffer.from(firstImage.inlineData.data, "base64"));

  return {
    images: [{ asset_path: rel, mime }],
    model: modelId,
    estimated_cost_usd: receiptCostUsd ?? pricingForModel(modelId).oneImageUsd,
  };
}
