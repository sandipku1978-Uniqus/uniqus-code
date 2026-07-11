import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { attachCitations, endIndexOfSpan, normalizeCitations, readCitations } from "./citations.js";
import { citationsFromContent } from "./providers/anthropic.js";
import { citationsFromGrounding } from "./providers/google.js";
import { citationsFromGlmSearch } from "./providers/zai.js";

describe("citations · normalizeCitations", () => {
  it("drops anything without an absolute http(s) url", () => {
    expect(
      normalizeCitations([
        { url: "https://a.dev" },
        { url: "  " },
        { url: "javascript:alert(1)" },
        { url: "/relative/path" },
        null,
        undefined,
      ]),
    ).toEqual([{ url: "https://a.dev" }]);
  });

  it("dedupes the same url at the same anchor but keeps distinct anchors", () => {
    const out = normalizeCitations([
      { url: "https://a.dev", endIndex: 10 },
      { url: "https://a.dev", endIndex: 10 },
      { url: "https://a.dev", endIndex: 42 },
    ]);
    expect(out).toEqual([
      { url: "https://a.dev", endIndex: 10 },
      { url: "https://a.dev", endIndex: 42 },
    ]);
  });

  it("orders by where the cited span ends, un-anchored last", () => {
    const out = normalizeCitations([
      { url: "https://c.dev" },
      { url: "https://b.dev", endIndex: 30 },
      { url: "https://a.dev", endIndex: 5 },
    ]);
    expect(out.map((c) => c.url)).toEqual(["https://a.dev", "https://b.dev", "https://c.dev"]);
  });
});

describe("citations · attach / read", () => {
  it("stamps the LAST text block and round-trips", () => {
    const content: Anthropic.ContentBlockParam[] = [
      { type: "text", text: "first" },
      { type: "text", text: "answer" },
    ];
    attachCitations(content, [{ url: "https://a.dev", endIndex: 6 }]);
    expect(readCitations(content[0])).toBeUndefined();
    expect(readCitations(content[1])).toEqual([{ url: "https://a.dev", endIndex: 6 }]);
  });

  it("is a no-op on a tool-call-only turn (nothing to cite against)", () => {
    const content = [
      { type: "tool_use", id: "t1", name: "read_file", input: {} },
    ] as unknown as Anthropic.ContentBlockParam[];
    attachCitations(content, [{ url: "https://a.dev" }]);
    expect(readCitations(content[0])).toBeUndefined();
  });
});

describe("citations · endIndexOfSpan", () => {
  it("returns the index just past the span, or undefined", () => {
    expect(endIndexOfSpan("hello world", "hello")).toBe(5);
    expect(endIndexOfSpan("hello world", "nope")).toBeUndefined();
    expect(endIndexOfSpan("hello", undefined)).toBeUndefined();
  });
});

describe("anthropic · citationsFromContent", () => {
  it("anchors each cited text block at its own end offset", () => {
    // Anthropic splits the answer into blocks; a block WITH citations IS the
    // cited span, so the marker belongs at that block's end.
    const content = [
      { type: "text", text: "Next.js 15.5", citations: null },
      {
        type: "text",
        text: " shipped in June.",
        citations: [
          {
            type: "web_search_result_location",
            url: "https://nextjs.org/blog",
            title: "Next.js 15.5",
            cited_text: "released June",
            encrypted_index: "xyz",
          },
        ],
      },
    ] as unknown as Anthropic.ContentBlock[];

    expect(citationsFromContent(content)).toEqual([
      { url: "https://nextjs.org/blog", title: "Next.js 15.5", endIndex: 29 },
    ]);
  });

  it("ignores non-web citation kinds (pdf/page locations)", () => {
    const content = [
      {
        type: "text",
        text: "hi",
        citations: [{ type: "page_location", document_index: 0 }],
      },
    ] as unknown as Anthropic.ContentBlock[];
    expect(citationsFromContent(content)).toEqual([]);
  });
});

describe("google · citationsFromGrounding", () => {
  const answer = "Next.js 15.5 shipped in June.";

  it("anchors a support at the end of its segment text", () => {
    const grounding = {
      groundingChunks: [{ web: { uri: "https://nextjs.org", title: "Next.js" } }],
      groundingSupports: [{ segment: { text: "Next.js 15.5" }, groundingChunkIndices: [0] }],
    };
    expect(citationsFromGrounding(grounding as never, answer)).toEqual([
      { url: "https://nextjs.org", title: "Next.js", endIndex: 12 },
    ]);
  });

  it("falls back to un-anchored chunks when the model emits no supports", () => {
    const grounding = {
      groundingChunks: [{ web: { uri: "https://nextjs.org", title: "Next.js" } }],
    };
    expect(citationsFromGrounding(grounding as never, answer)).toEqual([
      { url: "https://nextjs.org", title: "Next.js" },
    ]);
  });

  it("returns nothing when the turn did not ground", () => {
    expect(citationsFromGrounding(undefined, answer)).toEqual([]);
  });
});

describe("zai · citationsFromGlmSearch", () => {
  it("orders by `refer` so the model's own [n] markers line up", () => {
    // GLM writes [1]/[2] into its answer; refer is the mapping. Order matters:
    // the UI links marker n to source n.
    expect(
      citationsFromGlmSearch([
        { title: "Second", link: "https://b.dev", refer: "ref_2" },
        { title: "First", link: "https://a.dev", refer: "ref_1" },
      ]),
    ).toEqual([
      { url: "https://a.dev", title: "First" },
      { url: "https://b.dev", title: "Second" },
    ]);
  });

  it("skips results with no link rather than emitting a dead marker", () => {
    expect(citationsFromGlmSearch([{ title: "No link", refer: "ref_1" }])).toEqual([]);
  });
});
