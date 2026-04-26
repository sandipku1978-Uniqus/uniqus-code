import { parse as parseCookie } from "cookie";
import { sealData, unsealData } from "iron-session";

/**
 * Shape of the session payload AuthKit stores in the sealed cookie.
 * We only need the user record on the orchestrator side.
 */
export interface AuthKitSession {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profilePictureUrl?: string | null;
  };
  impersonator?: unknown;
}

const COOKIE_NAME = "wos-session";

export async function unsealSessionFromCookieHeader(
  cookieHeader: string | undefined,
): Promise<AuthKitSession | null> {
  if (!cookieHeader) return null;
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  const cookies = parseCookie(cookieHeader);
  const sealed = cookies[COOKIE_NAME];
  if (!sealed) return null;
  try {
    const data = await unsealData<AuthKitSession>(sealed, { password });
    if (!data?.user?.id) return null;
    return data;
  } catch {
    return null;
  }
}

// Re-export so the web app's API routes (which run in node) can also seal/unseal
// using the same password. Not strictly needed by the orchestrator itself.
export { sealData, unsealData };
