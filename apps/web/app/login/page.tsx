import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import BrandLockup from "@/components/BrandLockup";
import GuestLoginActions from "@/components/GuestLoginActions";
import { getGuestSession } from "@/lib/guest-server";
import { legalPolicyLinks } from "@/lib/legal-policies";
import {
  billingPostAuthHref,
  billingSettingsHref,
  parseBillingSelection,
} from "@/lib/billing-display";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; max_monthly_usd?: string; billing_settings?: string }>;
}) {
  // Already signed in with a WorkOS account → skip the card. A guest visitor
  // is deliberately NOT redirected: /login is their upgrade path, and the
  // place to restore a guest account from a recovery code.
  const { user } = await withAuth();
  const params = await searchParams;
  const billingSelection = parseBillingSelection(params.plan, params.max_monthly_usd);
  const returnToBilling = params.billing_settings === "1";
  const policies = legalPolicyLinks();
  const isExistingGuest = !!(await getGuestSession());
  if (user) {
    // Both cookies means conversion has not completed yet. Route through the
    // dashboard handoff before opening billing so the paid account inherits the
    // guest projects and the single lifetime Free allowance atomically.
    redirect(
      isExistingGuest
        ? billingPostAuthHref(billingSelection, false, returnToBilling)
        : billingSelection || returnToBilling
          ? billingSettingsHref(billingSelection)
          : "/projects",
    );
  }

  // Route through /projects so an existing guest is merged before checkout. The
  // validated billing selection then returns them to the exact Settings offer.
  const signInUrl = await getSignInUrl({
    returnTo: billingPostAuthHref(billingSelection, false, returnToBilling),
  });

  return (
    <main id="main-content" tabIndex={-1} className="login-shell">
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
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              fontSize: 12,
              color: "var(--text-muted)",
              textDecoration: "none",
            }}
          >
            New here? Read the docs →
          </a>
        </div>
        <div className="footer">
          Authentication is handled securely by WorkOS. {policies.terms ? (
            <a href={policies.terms} target="_blank" rel="noopener noreferrer">Terms</a>
          ) : (
            "Terms unavailable"
          )}{" · "}{policies.privacy ? (
            <a href={policies.privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
          ) : (
            "Privacy unavailable"
          )}
        </div>
      </div>
    </main>
  );
}
