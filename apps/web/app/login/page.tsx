import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
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
          <span className="lockup">
            <span className="mark">u</span>
            <span>uniqus</span>
            <span className="slash">/</span>
            <span className="code">code</span>
          </span>
        </div>
        <h1>Sign in</h1>
        <p className="sub">Engineering, on demand.</p>
        <a href={signInUrl} className="signin-btn">
          Continue securely
        </a>
        <GuestLoginActions isExistingGuest={isExistingGuest} />
        <div className="footer">
          By signing in you agree to the terms and privacy policy.
        </div>
      </div>
    </main>
  );
}
