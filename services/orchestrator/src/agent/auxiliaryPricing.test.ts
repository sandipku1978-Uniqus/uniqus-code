import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  conservativeMediaInputTokens,
  conservativePdfOcrInputTokens,
  executeTool,
  type AuxiliaryProviderBoundary,
} from "./loop.js";
import { assertPlatformModelPriced } from "./runSpend.js";

describe("auxiliary platform pricing boundary", () => {
  let rootDir: string;
  let previousVisionModel: string | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "gate15-aux-pricing-"));
    previousVisionModel = process.env.VISION_BRIDGE_MODEL;
    process.env.VISION_BRIDGE_MODEL = "gemini-future-unpriced-vision";
    await writeFile(
      path.join(rootDir, "pixel.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64",
      ),
    );
  });

  afterEach(async () => {
    if (previousVisionModel === undefined) delete process.env.VISION_BRIDGE_MODEL;
    else process.env.VISION_BRIDGE_MODEL = previousVisionModel;
    await rm(rootDir, { recursive: true, force: true });
  });

  it("rejects an unpriced VISION_BRIDGE_MODEL before the provider starts", async () => {
    const start = vi.fn();
    const unknown = vi.fn();
    const boundary: AuxiliaryProviderBoundary = {
      assertModelPriced: (provider, model) =>
        assertPlatformModelPriced(model, true, `${provider} helper`),
      remaining: () => 5,
      start,
      settle: vi.fn(),
      unknown,
    };

    await expect(
      executeTool(
        { rootDir },
        "analyze_image",
        { path: "pixel.png", question: "What is shown?" },
        "tool-1",
        null,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
        undefined,
        undefined,
        "google-key",
        null,
        false,
        undefined,
        undefined,
        boundary,
      ),
    ).rejects.toThrow("has no explicit platform price");

    expect(start).not.toHaveBeenCalled();
    expect(unknown).not.toHaveBeenCalled();
  });

  it("reserves compact PDFs by page count as well as transport bytes", () => {
    const compactDataUrl = "data:application/pdf;base64,AA==";
    expect(conservativePdfOcrInputTokens(compactDataUrl, 1_000)).toBe(
      1_000 * 258 + 256,
    );
    expect(conservativePdfOcrInputTokens(compactDataUrl)).toBe(
      1_000 * 258 + 256,
    );
    const largeDataUrl = `data:application/pdf;base64,${"A".repeat(300_000)}`;
    expect(conservativePdfOcrInputTokens(largeDataUrl, 1)).toBe(
      Buffer.byteLength(largeDataUrl, "utf8") + 256,
    );
  });

  it("uses the full media-model context only for platform-funded bridges", () => {
    expect(conservativeMediaInputTokens(2_500, "gemini-3.5-flash", true)).toBe(
      1_000_000,
    );
    expect(conservativeMediaInputTokens(2_500, "gemini-3.5-flash", false)).toBe(
      2_500,
    );
  });
});
