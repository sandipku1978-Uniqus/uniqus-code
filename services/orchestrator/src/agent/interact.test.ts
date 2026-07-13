import { describe, expect, it } from "vitest";
import { previewBlockingReasons, type InteractResult } from "./interact.js";

function result(overrides: Partial<InteractResult> = {}): InteractResult {
  return {
    asset_path: "assets/screenshots/test.png",
    resolved_url: "http://preview.invalid",
    final_url: "http://preview.invalid",
    page_title: "Preview",
    steps: [{ index: 0, action: "open", ok: true, url: "http://preview.invalid" }],
    console_errors: [],
    failed_requests: [],
    assertion_failures: [],
    a11y_issues: [],
    layout_issues: [],
    blocking_console_errors: [],
    hydration_errors: [],
    ...overrides,
  };
}

describe("previewBlockingReasons", () => {
  it("passes only when every interaction and visual release gate is clean", () => {
    expect(previewBlockingReasons(result())).toEqual([]);
  });

  it("blocks failed steps, accessibility, layout, contrast, and runtime failures", () => {
    expect(
      previewBlockingReasons(
        result({
          steps: [{ index: 0, action: "submit", ok: false, url: "http://preview.invalid" }],
          assertion_failures: ["expected success message"],
          blocking_console_errors: ["Hydration failed", "Unhandled rejection"],
          hydration_errors: ["Hydration failed"],
          a11y_issues: [{ id: "label", help: "missing label", nodes: 2 }],
          layout_issues: [{ id: "low-contrast", help: "low contrast", nodes: 1 }],
        }),
      ),
    ).toEqual([
      "1 failed interaction step(s)",
      "1 assertion failure(s)",
      "1 React hydration error(s)",
      "1 other console error(s)",
      "1 accessibility finding(s)",
      "1 layout/contrast finding(s)",
    ]);
  });
});
