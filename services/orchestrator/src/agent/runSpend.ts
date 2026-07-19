import { MODEL_PRICING } from "@gate15/api-types";

/** Analytics may estimate unknown models; platform-funded hard caps may not. */
export function assertPlatformModelPriced(
  model: string,
  platformFunded: boolean,
  purpose: string,
): void {
  if (!platformFunded || Object.prototype.hasOwnProperty.call(MODEL_PRICING, model)) return;
  throw new Error(
    `The ${purpose} request was not started because model "${model}" has no ` +
      "explicit platform price. Add that provider's key or choose a priced model.",
  );
}

/**
 * One run-scoped source of truth for Gate 15-funded spend.
 *
 * Known receipts reduce the remaining budget. Once any provider request has an
 * unknown outcome, the rest of the platform allocation is quarantined: no more
 * platform-funded request may start, while account-funded work can continue.
 */
export class RunPlatformSpend {
  private knownRunUsd = 0;
  private knownExternalUsd = 0;
  private delegatedUsd = 0;
  private unknown = false;

  constructor(private readonly budgetUsd?: number) {}

  record(costUsd: number, settledExternally = false): void {
    const cost = Number.isFinite(costUsd) ? Math.max(0, costUsd) : 0;
    if (settledExternally) this.knownExternalUsd += cost;
    else this.knownRunUsd += cost;
  }

  quarantineUnknown(): void {
    this.unknown = true;
  }

  get hasUnknownSpend(): boolean {
    return this.unknown;
  }

  /** Cost this run owns and must settle (external plan calls are excluded). */
  get runCostUsd(): number {
    return this.knownRunUsd;
  }

  get knownCostUsd(): number {
    return this.knownRunUsd + this.knownExternalUsd;
  }

  /** Hold a child allocation so the parent cannot spend it concurrently. */
  delegate(requestedUsd: number): number {
    const requested = Number.isFinite(requestedUsd) ? Math.max(0, requestedUsd) : 0;
    const available = this.remaining();
    const allocation = available === undefined ? requested : Math.min(requested, available);
    this.delegatedUsd += allocation;
    return allocation;
  }

  /** Return a known child allocation, or quarantine it when its spend is unknown. */
  finishDelegation(allocationUsd: number, unknownSpend: boolean): void {
    if (unknownSpend) {
      this.quarantineUnknown();
      return;
    }
    const allocation = Number.isFinite(allocationUsd) ? Math.max(0, allocationUsd) : 0;
    this.delegatedUsd = Math.max(0, this.delegatedUsd - allocation);
  }

  remaining(): number | undefined {
    if (this.budgetUsd === undefined) return undefined;
    if (this.unknown) return 0;
    return Math.max(0, this.budgetUsd - this.knownCostUsd - this.delegatedUsd);
  }
}
