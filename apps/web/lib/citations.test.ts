import { describe, expect, it } from "vitest";
import { renderAnswer } from "./citations";

const citations = [{ url: "https://example.com/source", title: "Source" }];

describe("renderAnswer unanchored citations", () => {
  it("linkifies prose markers without rewriting inline code", () => {
    const rendered = renderAnswer("Use source [1], not `arr[1]`.", citations);

    expect(rendered.markdown).toBe(
      "Use source [[1]](<https://example.com/source>), not `arr[1]`.",
    );
  });

  it("protects fenced and unterminated code while still linking later prose", () => {
    const fenced = renderAnswer("```ts\nconst x = arr[1];\n```\nSource [1]", citations);
    expect(fenced.markdown).toContain("const x = arr[1]");
    expect(fenced.markdown).toContain("Source [[1]](<https://example.com/source>)");

    const streaming = renderAnswer("```ts\nconst x = arr[1]", citations);
    expect(streaming.markdown).toBe("```ts\nconst x = arr[1]");
  });
});
