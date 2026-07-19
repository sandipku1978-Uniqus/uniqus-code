// Plain-English copy for agent-run errors (C7). The orchestrator tags an error
// event with a machine-readable `code`; this maps it to a friendly title +
// explanation + a couple of concrete "here's what to try" suggestions, so the
// chat shows a human card instead of a raw `error: <stack>` line. Falls back to
// pattern-matching the raw message for older servers that don't send a code.

export interface ErrorCopy {
  title: string;
  plain: string;
  suggestions: string[];
  action?: {
    label: string;
    href: string;
  };
  hideRetry?: boolean;
  hideSimplify?: boolean;
}

const BY_CODE: Record<string, ErrorCopy> = {
  rate_limit: {
    title: "Hit a rate limit",
    plain:
      "The AI provider is briefly limiting how fast requests come in. This almost always clears within a few seconds.",
    suggestions: ["Wait a moment, then retry the run.", "Or switch to a different model and try again."],
  },
  overloaded: {
    title: "The model is overloaded right now",
    plain: "The AI provider is at capacity. It's usually brief and not related to your project.",
    suggestions: ["Retry the run in a few seconds.", "Or pick another model from the picker."],
  },
  provider_5xx: {
    title: "The AI provider had a server error",
    plain: "Something went wrong on the provider's side — not in your project or your prompt.",
    suggestions: ["Retry the run — these are usually transient.", "If it keeps happening, try a different model."],
  },
  provider_auth: {
    title: "The provider rejected the API key",
    plain: "The API key for this model was refused. That's a configuration issue, not your request.",
    suggestions: ["Check the provider API key in Settings.", "If you're using your own key, re-enter it."],
  },
  missing_key: {
    title: "No API key for that model",
    plain: "The model you picked needs a provider API key that isn't set up.",
    suggestions: ["Pick a model that's already configured.", "Or add the provider key in Settings."],
  },
  credits_exhausted: {
    title: "Build credits are exhausted",
    plain:
      "Gate 15 stopped before starting another platform-funded model call. Choose a paid plan, or use your own provider keys on Plus or Max.",
    suggestions: ["Open Plan & billing to choose how you want to continue."],
    action: { label: "Manage plan & credits", href: "/settings#billing-settings" },
    hideRetry: true,
    hideSimplify: true,
  },
  byok_required: {
    title: "Add the required provider keys",
    plain:
      "This run cannot use Gate 15's shared keys. Anthropic is required for internal planning and compaction; a manually selected model also needs its own provider key.",
    suggestions: ["Add or replace the required keys in Settings, then run the request again."],
    action: { label: "Add provider keys", href: "/settings#provider-keys-settings" },
    hideRetry: true,
    hideSimplify: true,
  },
  subscription_inactive: {
    title: "Your subscription is not active",
    plain:
      "Gate 15 stopped before starting a paid model call. Open billing to resolve the subscription or choose another plan.",
    suggestions: ["Review the subscription status in the Stripe billing portal."],
    action: { label: "Manage billing", href: "/settings#billing-settings" },
    hideRetry: true,
    hideSimplify: true,
  },
  billing_unavailable: {
    title: "Billing could not be verified",
    plain:
      "No paid model call was started because Gate 15 could not confirm the plan and wallet safely.",
    suggestions: ["Retry once. If it continues, check Plan & billing before running more work."],
    action: { label: "Check billing", href: "/settings#billing-settings" },
    hideSimplify: true,
  },
  boot_timeout: {
    title: "The sandbox didn't start",
    plain:
      "Your project's sandbox didn't boot in time. We retried once automatically. A cold start occasionally needs another go.",
    suggestions: ["Retry the run.", "If it persists, reload the page, then try again."],
  },
  max_iterations: {
    title: "The build hit its step limit",
    plain:
      "The agent ran for the maximum number of steps without finishing. Your files and the sandbox state are preserved.",
    suggestions: ["Send a follow-up to continue from where it stopped.", "Or break the request into smaller steps."],
  },
};

const GENERIC: ErrorCopy = {
  title: "Something went wrong",
  plain: "The run stopped unexpectedly. Your files and chat history are safe.",
  suggestions: ["Retry the run.", "Or simplify the request and try again."],
};

export function errorCopyFor(code: string | undefined, raw: string): ErrorCopy {
  if (code && BY_CODE[code]) return BY_CODE[code];
  const m = (raw || "").toLowerCase();
  if (/rate.?limit|429/.test(m)) return BY_CODE.rate_limit;
  if (/overloaded|capacity|503/.test(m)) return BY_CODE.overloaded;
  if (/\b5\d\d\b|internal server error|bad gateway/.test(m)) return BY_CODE.provider_5xx;
  if (/api key|unauthorized|forbidden|\b401\b|\b403\b/.test(m)) return BY_CODE.provider_auth;
  if (/firecracker|sandbox|boot/.test(m)) return BY_CODE.boot_timeout;
  if (/max iterations/.test(m)) return BY_CODE.max_iterations;
  return GENERIC;
}
