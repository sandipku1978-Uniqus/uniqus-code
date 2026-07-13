import { withAuth } from "@workos-inc/authkit-nextjs";
import MarketingNav from "@/components/MarketingNav";
import LandingPrompt from "@/components/LandingPrompt";
import SiteFooter from "@/components/SiteFooter";
import { getGuestSession } from "@/lib/guest-server";

/**
 * Shared chrome for every public marketing sub-page (pricing, enterprise,
 * security, models, workspaces, templates, changelog, about, careers, blog,
 * contact, support, community, status).
 *
 * Auth is resolved ONCE here so the nav + the "start a project" composer send a
 * signed-in visitor (WorkOS or guest) to their dashboard instead of trapping
 * them at sign-in — the same rule the landing page uses. Pages themselves stay
 * auth-agnostic static server components; they only render their content into
 * `.mk-main`.
 *
 * The foot of every page reuses the landing page's `.bottom-build` block — the
 * same ember→signal brand gradient AND the same LandingPrompt "describe an idea
 * → new project" composer — so the whole marketing surface is consistent. The
 * composer lives ONLY here and on the landing page; the dashboard and the
 * account-gated screens (/projects, /settings, …) are outside this route group
 * and never render it.
 *
 * These routes are registered as unauthenticatedPaths in middleware.ts, so
 * they're reachable without an account.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await withAuth();
  const guest = user ? null : await getGuestSession();
  const signedIn = !!user || !!guest;
  const ctaHref = signedIn ? "/projects" : "/login";
  const ctaLabel = signedIn ? "Open dashboard" : "Start building";

  return (
    <div className="marketing-shell">
      <MarketingNav
        signedIn={signedIn}
        ctaHref={ctaHref}
        ctaLabel={signedIn ? "Open dashboard" : "Get started"}
      />

      <main className="mk-main">{children}</main>

      <section className="bottom-build" aria-label="Start a project">
        <div className="bottom-build-inner">
          <span className="bottom-kicker">AI app builder</span>
          <h2>Ready to build?</h2>
          <LandingPrompt
            variant="bottom"
            signedIn={signedIn}
            ctaHref={ctaHref}
            ctaLabel={ctaLabel}
            placeholder="Ask Gate 15 to build an app for…"
          />
          <p className="bottom-note">
            Free for solo projects. Team plans from $20/seat/month. Enterprise on
            request.
          </p>
        </div>
        <SiteFooter />
      </section>
    </div>
  );
}
