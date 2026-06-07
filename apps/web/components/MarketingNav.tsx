import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";

/**
 * Top navigation for marketing sub-pages. Mirrors the landing-page nav but
 * with cross-page links instead of in-page anchors. Auth-aware CTAs are
 * resolved once by the `(marketing)` layout and passed down, so a signed-in
 * visitor is sent to their dashboard rather than back through sign-in.
 */

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Pricing", href: "/pricing" },
  { label: "AI models", href: "/models" },
  { label: "Workspaces", href: "/workspaces" },
  { label: "Enterprise", href: "/enterprise" },
  { label: "Guide", href: "/guide" },
];

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
