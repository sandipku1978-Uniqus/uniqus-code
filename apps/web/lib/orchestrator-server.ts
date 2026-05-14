/**
 * Server-side fetch to the orchestrator that forwards the incoming request's
 * cookies — Server Components and Route Handlers don't relay them automatically
 * the way the browser does. Used for the guest → WorkOS conversion call.
 */

import { cookies } from "next/headers";

export async function orchestratorFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = (
    process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:8787"
  ).replace(/\/$/, "");
  const cookieHeader = (await cookies()).toString();
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: cookieHeader },
    cache: "no-store",
  });
}
