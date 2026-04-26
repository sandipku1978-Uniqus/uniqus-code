import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  // If you're already signed in, skip the sign-in card and go straight to projects.
  const { user } = await withAuth();
  if (user) redirect("/projects");

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
          Continue with WorkOS
        </a>
        <div className="footer">
          By signing in you agree to the terms and privacy policy.
        </div>
      </div>
    </main>
  );
}
