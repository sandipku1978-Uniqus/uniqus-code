/**
 * Server-component / route-handler helper for the guest cookie. Split from
 * guest-session.ts because this imports next/headers, which must not end up
 * in the Edge middleware's module graph.
 */

import { cookies } from "next/headers";
import {
  GUEST_COOKIE_NAME,
  unsealGuestCookie,
  type GuestSession,
} from "./guest-session";

/** Read + unseal the guest cookie. Returns null when the visitor isn't a guest. */
export async function getGuestSession(): Promise<GuestSession | null> {
  const store = await cookies();
  return unsealGuestCookie(store.get(GUEST_COOKIE_NAME)?.value);
}
