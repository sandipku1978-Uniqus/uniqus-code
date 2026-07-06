import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";
import NavExploreMenu from "@/components/NavExploreMenu";

/**
 * Top navigation for marketing sub-pages. Mirrors the landing-page nav but
 * with cross-page links instead of in-page anchors. Auth-aware CTAs are
 * resolved once by the `(marketing)` layout and passed down, so a signed-in
 * visitor is sent to their dashboard rather than back through sign-in. The
 * trailing Explore dropdown (NavExploreMenu) surfaces every other marketing
 * page — previously reachable only from the footer at the bottom of a page.
 */

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Pricing", href: "/pricing" },
  { label: "AI models", href: "/models" },
  { label: "Workspaces", href: "/workspaces" },
  { label: "Enterprise", href: "/enterprise" },
  { label: "Docs", href: "/docs" },
];
const NAV_HREFS = NAV_LINKS.map((l) => l.href);

export default function MarketingNav({
  signedIn,
  ctaHref,
  ctaLabel,
}: {
  signedIn: boolean;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <nav className="topnav marketing-nav">
      <Link href="/" className="brand-link">
        <BrandLockup />
      </Link>
      <div className="links">
        {NAV_LINKS.map((link) => (
          <Link href={link.href} key={link.href}>
            {link.label}
          </Link>
        ))}
        <NavExploreMenu excludeHrefs={NAV_HREFS} />
      </div>
      <div className="right">
        {!signedIn && (
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
        )}
        <Link href={ctaHref} className="btn-primary">
          {ctaLabel}
        </Link>
      </div>
    </nav>
  );
}
