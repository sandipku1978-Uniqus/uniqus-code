import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import BrandLockup from "@/components/BrandLockup";
import GuestLoginActions from "@/components/GuestLoginActions";
import { getGuestSession } from "@/lib/guest-server";

export default async function LoginPage() {
  // Already signed in with a WorkOS account → skip the card. A guest visitor
  // is deliberately NOT redirected: /login is their upgrade path, and the
  // place to restore a guest account from a recovery code.
  const { user } = await withAuth();
  if (user) redirect("/projects");
  const isExistingGuest = !!(await getGuestSession());

  // Land on /projects after auth, not /, so we don't loop back through marketing.
  const signInUrl = await getSignInUrl({ returnTo: "/projects" });

  return (
    <main className="login-shell">
      <div className="login-card">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <BrandLockup />
        </div>
        <h1>Sign in</h1>
        <p className="sub">Engineering, on demand.</p>
        <a href={signInUrl} className="signin-btn">
          Continue securely
        </a>
        <GuestLoginActions isExistingGuest={isExistingGuest} />
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <a
            href="/docs"
            style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}
          >
            New here? Read the docs →
          </a>
        </div>
        <div className="footer">
          By signing in you agree to the terms and privacy policy.
        </div>
      </div>
    </main>
  );
}
