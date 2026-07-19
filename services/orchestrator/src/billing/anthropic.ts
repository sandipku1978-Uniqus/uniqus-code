import { randomUUID } from "node:crypto";
import { estimateTurnCostUsd } from "@gate15/api-types";
import {
  resolveProviderKeysForUserWithSources,
  type ProviderKeyPolicy,
  type ResolvedProviderKeys,
} from "../db/providerKeys.js";
import { conservativeRequestCostUsd } from "../agent/compact.js";
import { assertPlatformModelPriced } from "../agent/runSpend.js";
import {
  BillingAccessError,
  authorizeAiRun,
  chargeAiUsage,
  reservePlatformBillingBudget,
} from "./service.js";

interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface MeteredAnthropicCall {
  userId: string;
  runId: string;
  apiKey: string;
  platformFunded: boolean;
  platformBudgetUsd: number;
  providerCallStarted: boolean;
  settled: boolean;
}

/**
 * Resolve the Anthropic credential under the user's current billing policy.
 * Every one-shot/internal Claude feature uses this instead of reading the
 * platform environment directly, so BYOK can never silently fall back to us.
 */
export async function beginMeteredAnthropicCall(
  userId: string,
): Promise<MeteredAnthropicCall> {
  let access = await authorizeAiRun(userId, "anthropic:claude-sonnet-4-6");
  let resolved = await resolveAnthropicCredential(userId, access.keyPolicy);
  const runId = randomUUID();

  if (resolved.sources.anthropic === "platform") {
    access = {
      ...access,
      platformBudgetUsd: await reservePlatformBillingBudget({
        userId,
        runId,
        availableBudgetUsd: access.platformBudgetUsd,
        preferReliability: false,
      }),
    };
  }

  const platformFunded = resolved.sources.anthropic === "platform";
  return {
    userId,
    runId,
    apiKey: resolved.keys.anthropic,
    platformFunded,
    platformBudgetUsd: access.platformBudgetUsd,
    providerCallStarted: false,
    settled: false,
  };
}

/** Mark the network billing boundary immediately before calling Anthropic. */
export function markMeteredAnthropicCallStarted(call: MeteredAnthropicCall): void {
  call.providerCallStarted = true;
}

/** Maximum output that fits the wallet under a conservative cold-cache envelope. */
export function affordableAnthropicOutputTokens(input: {
  call: MeteredAnthropicCall;
  model: string;
  estimatedInputTokens: number;
  requestedOutputTokens: number;
}): number {
  const requested = Math.max(1, Math.floor(input.requestedOutputTokens));
  assertPlatformModelPriced(input.model, input.call.platformFunded, "Anthropic helper");
  if (!input.call.platformFunded) return requested;
  const estimatedInputTokens = Math.max(0, Math.ceil(input.estimatedInputTokens));
  const cost = (outputTokens: number): number =>
    conservativeRequestCostUsd(input.model, estimatedInputTokens, outputTokens);
  if (cost(1) > input.call.platformBudgetUsd) {
    throw new BillingAccessError(
      "credits_exhausted",
      "The remaining usage credit is too small to start this AI request safely. Add provider keys or choose a plan with more credits.",
    );
  }
  let low = 1;
  let high = requested;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cost(mid) <= input.call.platformBudgetUsd) low = mid;
    else high = mid - 1;
  }
  return low;
}

async function resolveAnthropicCredential(
  userId: string,
  keyPolicy: ProviderKeyPolicy,
): Promise<
  ResolvedProviderKeys & {
    keys: ResolvedProviderKeys["keys"] & { anthropic: string };
  }
> {
  let resolved;
  try {
    resolved = await resolveProviderKeysForUserWithSources(userId, keyPolicy);
  } catch (err) {
    throw new BillingAccessError(
      "billing_unavailable",
      `Provider credentials could not be verified. ${errorText(err)}`,
    );
  }
  const anthropic = resolved.keys.anthropic;
  if (!anthropic) {
    throw new BillingAccessError(
      "byok_required",
      "Add an Anthropic API key in Settings before using this feature on your current plan.",
    );
  }
  return { ...resolved, keys: { ...resolved.keys, anthropic } };
}

/** Debit a completed provider response before its output is returned or saved. */
export async function settleMeteredAnthropicCall(input: {
  call: MeteredAnthropicCall;
  model: string;
  usage: AnthropicUsage;
}): Promise<void> {
  if (!input.call.platformFunded) return;
  const usage = {
    inputTokens: input.usage.input_tokens ?? 0,
    outputTokens: input.usage.output_tokens ?? 0,
    cacheReadTokens: input.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: input.usage.cache_creation_input_tokens ?? 0,
  };
  const hasReceipt = Object.values(usage).some((tokens) => tokens > 0);
  const costUsd = hasReceipt ? estimateTurnCostUsd(input.model, usage) : 0;
  try {
    await chargeAiUsage({
      userId: input.call.userId,
      runId: input.call.runId,
      costUsd,
      unknownPlatformSpend: !hasReceipt,
      reservedBudgetUsd: input.call.platformBudgetUsd,
    });
    input.call.settled = true;
  } catch (err) {
    throw new BillingAccessError(
      "billing_unavailable",
      `AI usage was completed, but its credit settlement could not be recorded. ${errorText(err)}`,
    );
  }
}

export async function releaseMeteredAnthropicCall(
  call: MeteredAnthropicCall,
): Promise<void> {
  if (!call.platformFunded || call.settled) return;
  try {
    await chargeAiUsage({
      userId: call.userId,
      runId: call.runId,
      costUsd: 0,
      unknownPlatformSpend: call.providerCallStarted,
      reservedBudgetUsd: call.platformBudgetUsd,
    });
    call.settled = true;
  } catch (err) {
    if (call.providerCallStarted) {
      console.error(`[billing] failed to retain unknown Anthropic spend ${call.runId}:`, err);
    } else {
      // Fail safe: keep the escrow consumed when its refund cannot be proven.
      console.error(`[billing] failed to refund unused Anthropic escrow ${call.runId}:`, err);
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
