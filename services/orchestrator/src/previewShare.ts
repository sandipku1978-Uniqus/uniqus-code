import { randomBytes } from "node:crypto";

/**
 * Revocable, time-boxed share tokens for preview servers (C3).
 *
 * The owner's own preview is reached via the unguessable `serverId` capability
 * (unchanged). Sharing that raw URL would hand out a capability that lives as
 * long as the dev server and can't be revoked. Instead, "Share" mints a SEPARATE
 * token → `/preview/share/<token>/`. The token:
 *   - expires (default 2h, and the dev server is ephemeral anyway),
 *   - is revocable (DELETE), and
 *   - never exposes the long-lived serverId to the recipient.
 * In-memory, matching the in-memory server registry — both vanish on restart.
 */
interface ShareEntry {
  serverId: string;
  projectId: string | null;
  expiresAt: number;
}

const shares = new Map<string, ShareEntry>();
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h

export function createShareToken(
  serverId: string,
  projectId: string | null,
  ttlMs: number = DEFAULT_TTL_MS,
): { token: string; expiresAt: number } {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + ttlMs;
  shares.set(token, { serverId, projectId, expiresAt });
  return { token, expiresAt };
}

/** Resolve a token to its serverId, or null if unknown/expired (and prune it). */
export function resolveShareToken(token: string): string | null {
  const e = shares.get(token);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    shares.delete(token);
    return null;
  }
  return e.serverId;
}

export function revokeShareToken(token: string): boolean {
  return shares.delete(token);
}

/** Drop every token for a server (e.g. when it stops). */
export function revokeSharesForServer(serverId: string): void {
  for (const [t, e] of shares) if (e.serverId === serverId) shares.delete(t);
}

/**
 * Periodically evict expired tokens. resolveShareToken only prunes a token when
 * it is looked up again after expiry, so tokens that simply expire (or whose
 * server stopped without a revoke) lingered in the Map for the process lifetime,
 * an unbounded slow leak on a long-lived orchestrator (C-99). Idempotent; call
 * once at startup.
 */
let sweeper: ReturnType<typeof setInterval> | null = null;
export function startShareTokenSweeper(intervalMs = 10 * 60 * 1000): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [t, e] of shares) if (e.expiresAt <= now) shares.delete(t);
  }, intervalMs);
  // Don't keep the event loop alive just for the sweep.
  sweeper.unref?.();
}
