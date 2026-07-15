import { signOut } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { isSameOriginPost } from "@/lib/same-origin";

export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginPost(req)) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }
  // AuthKit clears the cookie and redirects through WorkOS's logout endpoint,
  // revoking the upstream session instead of merely deleting a browser cookie.
  await signOut({ returnTo: new URL("/login", req.url).toString() });
  throw new Error("WorkOS signOut returned without redirecting");
}
