import { describe, expect, it } from "vitest";
import {
  estimateImageGenerationCostUsd,
  imageGenerationInputTokenCeiling,
  imageGenerationUsageCostUsd,
  imageGenerationReceiptUsage,
  resolveImageModelId,
} from "./imagegen.js";

describe("image generation billing contract", () => {
  it("uses current stable model ids and conservative one-request ceilings", () => {
    expect(resolveImageModelId()).toBe("gemini-3.1-flash-image");
    expect(resolveImageModelId("nano-banana-pro")).toBe("gemini-3-pro-image");
    expect(estimateImageGenerationCostUsd()).toBeCloseTo(0.24576, 8);
    expect(estimateImageGenerationCostUsd("nano-banana-pro")).toBeCloseTo(0.49152, 8);
  });

  it("rejects an unpriced raw model instead of reserving the cheaper default", () => {
    expect(() => resolveImageModelId("gemini-future-expensive-image")).toThrow(
      "Unsupported image model",
    );
    expect(() => estimateImageGenerationCostUsd("gemini-future-expensive-image")).toThrow(
      "Unsupported image model",
    );
  });

  it("reserves the full supported input window for a tiny edit image", () => {
    expect(imageGenerationInputTokenCeiling("edit this", 1)).toBe(131_072);
    expect(imageGenerationInputTokenCeiling("generate this")).toBe(
      Buffer.byteLength("generate this", "utf8") + 256,
    );
  });

  it("charges a refusal receipt's candidate text instead of treating it as free", () => {
    const cost = imageGenerationUsageCostUsd(
      "gemini-3.1-flash-image",
      {
        promptTokenCount: 10,
        thoughtsTokenCount: 20,
        candidatesTokenCount: 100,
        candidatesTokensDetails: [{ modality: "TEXT" as never, tokenCount: 100 }],
      },
      0,
    );

    expect(cost).toBeCloseTo((10 * 0.5 + 120 * 3) / 1_000_000, 12);
  });

  it("prices image and text candidate modalities at their separate rates", () => {
    const cost = imageGenerationUsageCostUsd(
      "gemini-3.1-flash-image",
      {
        promptTokenCount: 10,
        candidatesTokenCount: 1125,
        candidatesTokensDetails: [
          { modality: "IMAGE" as never, tokenCount: 1120 },
          { modality: "TEXT" as never, tokenCount: 5 },
        ],
      },
      1,
    );

    expect(cost).toBeCloseTo((10 * 0.5 + 1120 * 60 + 5 * 3) / 1_000_000, 12);
  });

  it("treats all-zero metadata as unknown and counts detailed candidate tokens", () => {
    expect(
      imageGenerationReceiptUsage({
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        thoughtsTokenCount: 0,
      }),
    ).toBeNull();
    expect(
      imageGenerationReceiptUsage({
        promptTokenCount: 10,
        candidatesTokensDetails: [{ modality: "IMAGE" as never, tokenCount: 1120 }],
      }),
    ).toMatchObject({ inputTokens: 10, outputTokens: 1120 });
  });
});
