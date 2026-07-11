/**
 * High-precision, text-free quality signal for an immediate correction turn.
 *
 * Callers may inspect the new user message in memory, but only the boolean
 * result is persisted. Keep the expressions deliberately conservative: a
 * false negative is cheaper than labelling an ordinary follow-up as a failed
 * builder result.
 */
const CORRECTION_PATTERNS = [
  /\b(?:that|this|it)\s+(?:still\s+)?(?:does(?:n't| not)|did(?:n't| not))\s+work\b/i,
  /\b(?:is|are|was|were)\s+still\s+(?:broken|wrong|incorrect|failing)\b/i,
  /\b(?:not|isn't|wasn't)\s+what\s+i\s+(?:asked|requested|meant)\b/i,
  /\byou\s+(?:missed|ignored|removed|broke)\b/i,
  /\b(?:still|remains?)\s+(?:broken|wrong|incorrect|failing|unfinished|missing)\b/i,
  /\btry\s+again\b/i,
  /\b(?:your|the)\s+(?:change|fix|implementation|answer|output)\s+(?:is|was)\s+(?:wrong|incorrect|broken|incomplete)\b/i,
] as const;

export function looksLikeImmediateCorrection(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const bounded = message.trim().slice(0, 2_000);
  if (!bounded) return false;
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(bounded));
}

