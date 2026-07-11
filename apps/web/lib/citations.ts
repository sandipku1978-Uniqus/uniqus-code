import type { Citation } from "@uniqus/api-types";

/**
 * Turn an answer + its citations into something renderable.
 *
 * Showing these is a provider requirement, not a nicety. OpenAI: "inline
 * citations must be made clearly visible and clickable in your user interface."
 * Anthropic: "citations must be included to the original source."
 *
 * Two shapes come back from the orchestrator:
 *  - ANCHORED (Anthropic, OpenAI, Gemini): each citation knows the character
 *    offset where its cited span ends, so we splice a marker in at that point.
 *  - UN-ANCHORED (GLM): the model already wrote `[1]`, `[2]` into its own prose
 *    and the citation list is the mapping, so we linkify the markers in place
 *    rather than adding a second set.
 * Either way, every source lands in the footer — including ones we could not
 * anchor, which is the honest rendering: we know it was used, not exactly where.
 */

export interface Source {
  /** 1-based number shown in the marker and the footer. */
  n: number;
  url: string;
  title?: string;
}

export interface RenderedAnswer {
  /** Markdown to render — the model's text, with citation links spliced in. */
  markdown: string;
  /** Deduped sources in citation order, for the footer. */
  sources: Source[];
}

/**
 * Ranges of `text` that live inside fenced or inline code, where splicing a
 * marker would corrupt the code the agent just wrote.
 *
 * Fences are scanned line-by-line rather than with one regex: a multiline
 * `[\s\S]*?…$` pattern terminates at the END OF THE OPENING LINE under the `m`
 * flag, which silently leaves the block's body unprotected.
 */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let fenceStart: number | null = null;
  let fenceChar: string | null = null;

  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    const fence = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fenceStart === null) {
      if (fence) {
        fenceStart = offset;
        fenceChar = fence[1][0];
      }
    } else if (fence && fence[1][0] === fenceChar) {
      ranges.push([fenceStart, lineEnd]);
      fenceStart = null;
      fenceChar = null;
    }
    offset = lineEnd + 1; // + the "\n" split consumed
  }
  // An unterminated fence (still streaming) protects the rest of the text.
  if (fenceStart !== null) ranges.push([fenceStart, text.length]);

  const inFence = (i: number): boolean => ranges.some(([s, e]) => i >= s && i < e);
  // Inline spans never cross a newline, and backticks inside a fence aren't spans.
  const inline = /(`+)[^`\n]*?\1/g;
  for (const m of text.matchAll(inline)) {
    if (m.index !== undefined && !inFence(m.index)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** Markdown link whose visible label is `[n]`, e.g. `[[1]](<https://…>)`. */
function marker(n: number, url: string): string {
  // Angle brackets around the destination so URLs containing parentheses
  // (Wikipedia, MDN) don't terminate the link early.
  return `[[${n}]](<${url}>)`;
}

export function renderAnswer(text: string, citations?: Citation[]): RenderedAnswer {
  if (!citations || citations.length === 0) return { markdown: text, sources: [] };

  // Number sources by first appearance; the same URL cited twice keeps one number.
  const byUrl = new Map<string, Source>();
  for (const c of citations) {
    if (!byUrl.has(c.url)) byUrl.set(c.url, { n: byUrl.size + 1, url: c.url, title: c.title });
  }
  const sources = [...byUrl.values()];

  const anchored = citations.filter(
    (c): c is Citation & { endIndex: number } =>
      typeof c.endIndex === "number" && c.endIndex >= 0 && c.endIndex <= text.length,
  );

  // GLM path: the model wrote its own markers. Linkify them where the number
  // maps to a source; leave unknown numbers alone rather than inventing a link.
  if (anchored.length === 0) {
    const markdown = text.replace(/\[(\d{1,2})\]/g, (whole, digits: string) => {
      const src = sources[Number(digits) - 1];
      return src ? marker(src.n, src.url) : whole;
    });
    return { markdown, sources };
  }

  // Anchored path: splice markers in from the end so earlier offsets stay valid.
  const skip = codeRanges(text);
  const inCode = (i: number): boolean => skip.some(([s, e]) => i > s && i < e);
  const inserts = anchored
    .map((c) => ({ at: c.endIndex, n: byUrl.get(c.url)!.n, url: c.url }))
    .filter((ins) => !inCode(ins.at))
    .sort((a, b) => b.at - a.at || b.n - a.n);

  let markdown = text;
  for (const ins of inserts) {
    markdown = markdown.slice(0, ins.at) + marker(ins.n, ins.url) + markdown.slice(ins.at);
  }
  return { markdown, sources };
}

/** `https://nextjs.org/blog/x` → `nextjs.org`. Falls back to the raw URL. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
