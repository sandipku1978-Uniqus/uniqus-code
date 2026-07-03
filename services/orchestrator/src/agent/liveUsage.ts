/**
 * Live output-token estimation for one streamed provider message.
 *
 * Every provider except Gemini reports output tokens only at the END of a
 * message (Anthropic: the final message_delta; OpenAI: response.completed;
 * Z.ai: the trailing include_usage chunk) — so while a model streamed a long
 * thinking phase the live "N out" counter sat FLAT, then jumped at the end.
 * GLM is the worst case: a single thinking phase can run for minutes with
 * zero counter movement, which read as "tokens aren't being counted".
 *
 * The estimator ticks the counter from streamed characters (text + thinking +
 * tool-arg JSON) between real usage reports. 4 chars/token is deliberately
 * LOW-biased (prose/code runs ~3.3–4 chars/token, CJK much lower) so the
 * correction when the adapter's authoritative report lands is upward, never a
 * visible dip. A real report resets the estimate; tool-arg lengths are tracked
 * per call id so only growth since the last report counts.
 *
 * Estimates ride the same emit path as real usage — callers that persist
 * usage must do so from the adapter's RETURNED turn usage (or a `real` emit),
 * never from an estimated tick.
 */

export interface LiveUsageSplit {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const EST_CHARS_PER_TOKEN = 4;
const EST_EMIT_MS = 500;

export function createLiveOutputEstimator(
  emit: (u: LiveUsageSplit, real: boolean) => void,
): {
  /** Streamed text/thinking characters. */
  addChars(n: number): void;
  /** Streamed partial tool args (a re-parsed object on each emission). */
  addToolPartial(id: string, partial: unknown): void;
  /** Authoritative usage from the adapter — resets the estimate. */
  onRealUsage(u: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  }): void;
} {
  let real: LiveUsageSplit = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let estChars = 0;
  let lastEstEmit = 0;
  const toolArgLens = new Map<string, number>();

  const addChars = (n: number): void => {
    if (n <= 0) return;
    estChars += n;
    const now = Date.now();
    if (now - lastEstEmit < EST_EMIT_MS) return;
    lastEstEmit = now;
    emit(
      { ...real, outputTokens: real.outputTokens + Math.floor(estChars / EST_CHARS_PER_TOKEN) },
      false,
    );
  };

  return {
    addChars,
    addToolPartial(id, partial) {
      try {
        const len = JSON.stringify(partial)?.length ?? 0;
        const prev = toolArgLens.get(id) ?? 0;
        if (len > prev) {
          toolArgLens.set(id, len);
          addChars(len - prev);
        }
      } catch {
        /* circular/unserializable partial — skip estimation */
      }
    },
    onRealUsage(u) {
      real = {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens ?? 0,
        cacheCreationTokens: u.cacheCreationTokens ?? 0,
      };
      estChars = 0;
      emit(real, true);
    },
  };
}
