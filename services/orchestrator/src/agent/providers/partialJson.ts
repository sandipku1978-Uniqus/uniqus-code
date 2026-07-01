/**
 * Best-effort parse of a STILL-STREAMING JSON fragment — a tool call's
 * `arguments` object as it arrives token by token. Providers stream the raw
 * JSON string incrementally (Anthropic `input_json_delta`, GLM/OpenAI
 * `arguments` deltas); this lets the UI show the file name / command / partial
 * `content` LIVE instead of a blank "running…" row, without waiting for the
 * whole object.
 *
 * The trick: walk the fragment tracking string/escape state and the bracket
 * stack, then synthesize the minimal suffix that closes it — end an open string,
 * drop a dangling key with no value, and append the matching `]`/`}` for every
 * still-open container — and JSON.parse the completed string. Whatever complete
 * key/values streamed so far come back; the in-flight tail is truncated
 * gracefully. Returns undefined if even the completion doesn't parse (e.g. the
 * fragment is empty or not yet a JSON object) — callers just skip that emit.
 *
 * Pure, allocation-light, and never throws.
 */
export function parsePartialJson(fragment: string): unknown {
  if (!fragment) return undefined;
  const s = fragment;
  // Fast path: already-complete JSON.
  try {
    return JSON.parse(s);
  } catch {
    /* fall through to completion */
  }

  const stack: string[] = []; // "{" or "["
  let inString = false;
  let escaped = false;
  // Track whether, inside the current object, we're positioned right after a key
  // (seen a ':' with no value yet) or after a key's colon — used to drop a
  // trailing `"key":` or dangling `"key"` that has no value yet.
  let lastSignificant = ""; // last non-whitespace char outside strings

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
        lastSignificant = '"';
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      lastSignificant = '"';
      continue;
    }
    if (c === "{" || c === "[") {
      stack.push(c);
      lastSignificant = c;
    } else if (c === "}" || c === "]") {
      stack.pop();
      lastSignificant = c;
    } else if (!/\s/.test(c)) {
      lastSignificant = c;
    }
  }

  let repaired = s;

  // Close an open string first.
  if (inString) {
    // A dangling backslash (escape started) would make the closing quote an
    // escaped quote — drop it before closing.
    if (escaped) repaired = repaired.slice(0, -1);
    repaired += '"';
    lastSignificant = '"';
  }

  // The innermost still-open container. Whether a trailing `,"str"` is a dangling
  // OBJECT KEY (to drop) or a complete ARRAY ELEMENT (to keep) depends on it — the
  // key/colon trims below apply ONLY inside an object. Getting this wrong dropped
  // the last element of an in-flight string array (`{"arr":["a","b` → `["a"]`).
  const innermost = (): string => (stack.length ? stack[stack.length - 1] : "");

  // Drop a trailing structural artifact that can't be completed into valid JSON:
  //   {"a":1,      → trailing comma (object OR array)
  //   {"a":        → object key with a colon but no value yet
  //   {"a"         → object key with no colon/value yet
  // Repeatedly trim these so the completion parses.
  const trimArtifacts = (): void => {
    // Remove trailing whitespace.
    repaired = repaired.replace(/\s+$/, "");
    // Trailing comma inside an object OR array — always safe to drop.
    if (/[,]$/.test(repaired)) {
      repaired = repaired.replace(/,$/, "");
      return;
    }
    // The key/element trims below are OBJECT-only: inside an array a trailing
    // `,"str"` is a finished element (keep it), not a half-typed key.
    if (innermost() !== "{") return;
    // "key": with no value — drop the key but KEEP its delimiter ('{' or ',')
    // so an opening brace isn't lost; a dangling ',' is then stripped.
    const colonKey = repaired.match(/[{,]\s*"(?:[^"\\]|\\.)*"\s*:\s*$/);
    if (colonKey && colonKey.index !== undefined) {
      repaired = repaired.slice(0, colonKey.index + 1);
      if (repaired.endsWith(",")) repaired = repaired.slice(0, -1);
      return;
    }
    // Bare "key" with no colon (still typing the key) — drop it.
    const bareKey = repaired.match(/[{,]\s*"(?:[^"\\]|\\.)*"\s*$/);
    if (bareKey && bareKey.index !== undefined) {
      // Keep the '{' or ',' delimiter char, drop the key.
      repaired = repaired.slice(0, bareKey.index + 1);
      if (repaired.endsWith(",")) repaired = repaired.slice(0, -1);
      return;
    }
  };

  // A few passes handle nested/compound artifacts.
  for (let pass = 0; pass < 4; pass++) trimArtifacts();

  // Close every still-open container.
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === "{" ? "}" : "]";
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}
