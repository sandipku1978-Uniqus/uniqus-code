// Resolve a filename to a VS Code "Seti" file icon — the exact glyph + color VS
// Code's built-in default file icon theme renders. The glyph is a character in
// the `seti` font (see public/fonts/seti.woff, @font-face in globals.css); the
// data tables come straight from VS Code's bundled theme JSON (seti-icons.data.ts).
//
// VS Code resolves a file in this order:
//   1. exact fileName            (e.g. "tsconfig.json", "dockerfile")
//   2. longest fileExtension     (e.g. "spec.ts" beats "ts")
//   3. languageId of the file    (e.g. ".ts" → typescript → _typescript)
//   4. the default file icon
//
// The Seti JSON only lists the *unusual* extensions explicitly; everyday source
// extensions (ts, js, py, json, css, …) resolve through step 3. VS Code derives
// the languageId from its language registry — we replicate the common slice of
// that registry below so normal code files get their real icon, not the default.

import {
  SETI_DEFAULT,
  SETI_FILE_EXTENSIONS,
  SETI_FILE_NAMES,
  SETI_ICON_DEFS,
  SETI_LANGUAGE_IDS,
} from "@/lib/seti-icons.data";

export interface ResolvedIcon {
  /** The glyph character to render in the `seti` font. */
  char: string;
  /** The icon's color (hex). */
  color: string;
}

// Single file extension → VS Code languageId. Only languages the Seti theme has
// an icon for are worth listing; anything else falls through to the default.
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  json: "json",
  json5: "json",
  jsonc: "jsonc",
  jsonl: "jsonl",
  py: "python",
  pyw: "python",
  pyi: "python",
  rb: "ruby",
  gemspec: "ruby",
  rake: "ruby",
  php: "php",
  phtml: "php",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  styl: "stylus",
  html: "html",
  htm: "html",
  xhtml: "html",
  xml: "xml",
  xsd: "xml",
  xsl: "xml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "shellscript",
  ksh: "shellscript",
  sql: "sql",
  swift: "swift",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  dart: "dart",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  coffee: "coffeescript",
  fs: "fsharp",
  fsx: "fsharp",
  fsi: "fsharp",
  jl: "julia",
  tex: "latex",
  m: "objective-c",
  mm: "objective-cpp",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "bat",
  cmd: "bat",
  groovy: "groovy",
  gvy: "groovy",
  ini: "properties",
  cfg: "properties",
  conf: "properties",
  properties: "properties",
  pug: "jade",
};

// Whole-filename → languageId, for files VS Code recognizes by name rather than
// extension (and that the Seti JSON resolves via languageId, not fileNames).
const NAME_TO_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  ".gitignore": "ignore",
  ".npmignore": "ignore",
  ".dockerignore": "ignore",
  ".editorconfig": "properties",
  ".bashrc": "shellscript",
  ".bash_profile": "shellscript",
  ".zshrc": "shellscript",
  ".profile": "shellscript",
};

/** Lowercased extension suffixes, longest first: "a.spec.ts" → ["spec.ts","ts"]. */
function extSuffixes(lower: string): string[] {
  const parts = lower.split(".");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join("."));
  return out;
}

/** Map a filename to a VS Code languageId (best-effort, common languages only). */
function languageOf(lower: string): string | undefined {
  if (NAME_TO_LANG[lower]) return NAME_TO_LANG[lower];
  // Dockerfile.dev, api.Dockerfile, …
  if (lower === "dockerfile" || lower.startsWith("dockerfile.") || lower.endsWith(".dockerfile"))
    return "dockerfile";
  // .env, .env.local, .env.production, …
  if (lower === ".env" || lower.startsWith(".env.")) return "dotenv";
  for (const suf of extSuffixes(lower)) {
    if (EXT_TO_LANG[suf]) return EXT_TO_LANG[suf];
  }
  return undefined;
}

function def(id: string): ResolvedIcon {
  const d = SETI_ICON_DEFS[id] ?? SETI_ICON_DEFS[SETI_DEFAULT];
  return { char: d.c, color: d.color };
}

/**
 * Resolve a filename (not a path) to its Seti icon glyph + color, following the
 * same precedence VS Code uses: exact name → longest extension → language →
 * default.
 */
export function resolveSetiIcon(name: string): ResolvedIcon {
  const lower = name.toLowerCase();

  // 1. exact filename
  const byName = SETI_FILE_NAMES[lower];
  if (byName) return def(byName);

  // 2. longest matching extension suffix
  for (const suf of extSuffixes(lower)) {
    const byExt = SETI_FILE_EXTENSIONS[suf];
    if (byExt) return def(byExt);
  }

  // 3. languageId
  const lang = languageOf(lower);
  if (lang && SETI_LANGUAGE_IDS[lang]) return def(SETI_LANGUAGE_IDS[lang]);

  // 4. default
  return def(SETI_DEFAULT);
}
