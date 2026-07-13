import { randomBytes, timingSafeEqual } from "node:crypto";

export function createRunReconnectCapability(): string {
  return randomBytes(32).toString("base64url");
}
function equalCapability(expected: string, supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A live run is private to its initiator and the capability minted for that run. */
export function mayReconnectToRun(args: {
  initiatorUserId: string;
  reconnectCapability: string;
  actorUserId: string;
  suppliedCapability: string | null | undefined;
}): boolean {
  return (
    args.actorUserId === args.initiatorUserId &&
    equalCapability(args.reconnectCapability, args.suppliedCapability)
  );
}
