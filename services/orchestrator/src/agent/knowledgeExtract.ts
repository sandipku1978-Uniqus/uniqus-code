/**
 * Best-effort plain-text extraction for uploaded Knowledge documents. The
 * extracted text is what powers the `knowledge_search` tool, so we try hard to
 * pull readable text out of the common office/document formats and fall back to
 * a clean "no text" signal for anything we can't parse (the raw file is still
 * stored and downloadable either way).
 *
 * Heavy parsers (pdf/xlsx/docx) are loaded with dynamic import so a missing
 * optional dependency degrades to "not extracted" instead of crashing the
 * orchestrator at startup.
 */

/** Hard cap on stored extracted text (~600 KB) — keeps the DB row + the
 *  search scan bounded. Larger docs are truncated with a marker. */
export const MAX_EXTRACT_CHARS = 600_000;

/** Extensions we can read directly as UTF-8 text (no parsing needed). */
const TEXT_EXTENSIONS = new Set([
  "txt", "text", "md", "markdown", "mdx", "rst",
  "csv", "tsv", "psv",
  "json", "jsonl", "ndjson", "geojson",
  "xml", "svg", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "log", "tex", "rtf",
  // common source/code files — useful as reference material
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java",
  "kt", "c", "h", "cpp", "cc", "hpp", "cs", "php", "swift", "sh", "bash",
  "sql", "graphql", "gql", "css", "scss", "less", "vue", "svelte",
]);

const HTML_EXTENSIONS = new Set(["html", "htm", "xhtml"]);

export interface ExtractResult {
  /** Extracted plain text (possibly truncated). Empty when extraction failed. */
  text: string;
  /** True when we got usable text out of the file. */
  ok: boolean;
}

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : "";
}

function cap(text: string): string {
  // Normalize non-breaking spaces to regular spaces; trim trailing whitespace.
  const cleaned = text.replace(/ /g, " ").trimEnd();
  if (cleaned.length <= MAX_EXTRACT_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_EXTRACT_CHARS)}\n\n[... truncated ${cleaned.length - MAX_EXTRACT_CHARS} characters ...]`;
}

/** Strip tags/scripts/styles from HTML and collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Decode &amp; LAST so an escaped entity like &amp;lt; doesn't double-decode.
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

async function extractPdf(buf: Buffer): Promise<string> {
  // Import the inner lib file directly: pdf-parse's package index runs a debug
  // block that reads a bundled test PDF when `module.parent` is falsy (which it
  // is under ESM) — importing the lib avoids that crash.
  const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as {
    default: (data: Buffer) => Promise<{ text: string }>;
  };
  const pdfParse = mod.default;
  const { text } = await pdfParse(buf);
  return text;
}

async function extractXlsx(buf: Buffer): Promise<string> {
  const mod = (await import("xlsx")) as unknown as {
    read: (data: Buffer, opts: { type: "buffer" }) => { SheetNames: string[]; Sheets: Record<string, unknown> };
    utils: { sheet_to_csv: (ws: unknown) => string };
  };
  const wb = mod.read(buf, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = mod.utils.sheet_to_csv(wb.Sheets[name]).trim();
    if (csv) parts.push(`# Sheet: ${name}\n${csv}`);
  }
  return parts.join("\n\n");
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mod = (await import("mammoth")) as unknown as {
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const { value } = await mod.extractRawText({ buffer: buf });
  return value;
}

/**
 * Extract plain text from an uploaded file buffer. Never throws — a parse
 * failure (corrupt file, missing optional parser) returns { text: "", ok: false }.
 */
export async function extractText(
  buf: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractResult> {
  const ext = extOf(fileName);
  const mime = (mimeType || "").toLowerCase();

  try {
    if (TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/") || mime === "application/json") {
      const text = cap(buf.toString("utf-8"));
      return { text, ok: text.trim().length > 0 };
    }
    if (HTML_EXTENSIONS.has(ext) || mime === "text/html") {
      const text = cap(htmlToText(buf.toString("utf-8")));
      return { text, ok: text.trim().length > 0 };
    }
    if (ext === "pdf" || mime === "application/pdf") {
      const text = await extractPdf(buf);
      return { text: cap(text), ok: text.trim().length > 0 };
    }
    if (
      ext === "xlsx" || ext === "xls" || ext === "xlsm" ||
      mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel"
    ) {
      const text = await extractXlsx(buf);
      return { text: cap(text), ok: text.trim().length > 0 };
    }
    if (
      ext === "docx" ||
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const text = await extractDocx(buf);
      return { text: cap(text), ok: text.trim().length > 0 };
    }
  } catch (err) {
    console.error(`knowledge extract failed for ${fileName} (${mime}):`, err);
    return { text: "", ok: false };
  }

  // Unknown/binary format — stored & downloadable, but not searchable.
  return { text: "", ok: false };
}
