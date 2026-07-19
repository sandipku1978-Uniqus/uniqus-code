import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";
import { legalPolicyLinks } from "@/lib/legal-policies";

/**
 * Shared marketing footer — the single source of truth for the footer
 * information architecture. Rendered both at the foot of the landing page
 * (inside `.bottom-build`) and on every marketing sub-page (via the
 * `(marketing)` layout). Links to the scaffolded pages under app/(marketing);
 * Only destinations owned by Gate 15 are published here. Policy and social
 * links stay absent until their authoritative destinations exist.
 */

type FooterLink = { label: string; href: string };
type FooterColumn = { title: string; links: FooterLink[] };

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "AI models", href: "/models" },
      { label: "Workspaces", href: "/workspaces" },
      { label: "Pricing", href: "/pricing" },
      { label: "Templates", href: "/templates" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Enterprise", href: "/enterprise" },
      { label: "Careers", href: "/careers" },
      { label: "Blog", href: "/blog" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Security", href: "/security" },
      { label: "Support", href: "/support" },
      { label: "Community", href: "/community" },
      { label: "Status", href: "/status" },
    ],
  },
];

function isExternal(href: string) {
  return href.startsWith("http") || href.startsWith("mailto:");
}

export default function SiteFooter() {
  const policies = legalPolicyLinks();
  return (
    <footer className="site-footer">
      <div className="footer-panel">
        <div className="footer-brand-block">
          <div>
            <BrandLockup style={{ fontSize: 16 }} />
            <p className="footer-tagline">
              Build real apps with the AI you trust.
            </p>
          </div>
          <div className="footer-brand-foot">
            <span className="footer-policy-links">
              &copy; 2026 Gate 15 ·{" "}
              {policies.terms ? (
                <a href={policies.terms} target="_blank" rel="noopener noreferrer">Terms</a>
              ) : (
                "Terms unavailable"
              )}
              {" · "}
              {policies.privacy ? (
                <a href={policies.privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
              ) : (
                "Privacy unavailable"
              )}
            </span>
          </div>
        </div>

        <div className="footer-columns">
          {FOOTER_COLUMNS.map((column) => (
            <div className="footer-column" key={column.title}>
              <h3>{column.title}</h3>
              {column.links.map((link) =>
                isExternal(link.href) ? (
                  <a
                    href={link.href}
                    key={link.label}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} key={link.label}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
