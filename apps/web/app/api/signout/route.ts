import { signOut } from "@workos-inc/authkit-nextjs";

export async function GET(req: Request): Promise<never> {
  // AuthKit clears the cookie and redirects through WorkOS's logout endpoint,
  // revoking the upstream session instead of merely deleting a browser cookie.
  await signOut({ returnTo: new URL("/login", req.url).toString() });
  throw new Error("WorkOS signOut returned without redirecting");
}
