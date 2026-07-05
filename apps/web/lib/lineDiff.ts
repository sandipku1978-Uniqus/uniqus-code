/**
 * Line-level diff stats — a client-side port of the orchestrator's
 * lineDiffStats (loop.ts), used for the LIVE +/− badge on a still-streaming
 * edit_file call. LCS over lines, so context lines shared between old and new
 * cancel out — the raw string sizes don't. Same guard as the server: fall back
 * to a coarse net-line estimate when the DP would be too large.
 */
export function lineDiffStats(
  oldText: string,
  newText: string,
): { added: number; removed: number } {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText ? newText.split("\n") : [];
  if (a.length === 0) return { added: b.length, removed: 0 };
  if (b.length === 0) return { added: 0, removed: a.length };
  if (a.length * b.length > 4_000_000) {
    return { added: Math.max(0, b.length - a.length), removed: Math.max(0, a.length - b.length) };
  }
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  const lcs = prev[n];
  return { added: n - lcs, removed: m - lcs };
}
