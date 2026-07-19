import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { isSameOriginPost } from "@/lib/same-origin";
import { workosSignOutResponse } from "@/lib/workos-signout";

export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginPost(req)) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }
  const returnTo = new URL("/login", req.url).toString();
  const { sessionId } = await withAuth();
  const destination = sessionId
    ? getWorkOS().userManagement.getLogoutUrl({ sessionId, returnTo })
    : returnTo;

  // Keep the upstream WorkOS logout, but expire the browser cookie ourselves.
  // The SDK's signOut helper did not reliably remove our domain-scoped cookie,
  // so /login still saw a user and immediately redirected back to /projects.
  return workosSignOutResponse(req, destination);
}
