import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";

/**
 * Shared marketing footer — the single source of truth for the footer
 * information architecture. Rendered both at the foot of the landing page
 * (inside `.bottom-build`) and on every marketing sub-page (via the
 * `(marketing)` layout). Links to the scaffolded pages under app/(marketing);
 * legal links point to gate15.dev (handled by the company site).
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
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "https://gate15.dev" },
      { label: "Terms", href: "https://gate15.dev" },
      { label: "Report abuse", href: "https://gate15.dev" },
    ],
  },
];

const SOCIALS: { label: string; href: string; icon: "x" | "github" | "linkedin" }[] = [
  { label: "X / Twitter", href: "https://x.com", icon: "x" },
  { label: "GitHub", href: "https://github.com", icon: "github" },
  { label: "LinkedIn", href: "https://www.linkedin.com", icon: "linkedin" },
];

function isExternal(href: string) {
  return href.startsWith("http") || href.startsWith("mailto:");
}

function SocialIcon({ icon }: { icon: "x" | "github" | "linkedin" }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    fill: "currentColor",
  };
  if (icon === "x")
    return (
      <svg {...common}>
        <path d="M17.53 3H20.5l-6.49 7.42L21.75 21h-6.02l-4.71-6.16L5.6 21H2.63l6.94-7.94L2.5 3h6.17l4.26 5.63L17.53 3Zm-1.06 16.2h1.65L7.6 4.7H5.83l10.64 14.5Z" />
      </svg>
    );
  if (icon === "github")
    return (
      <svg {...common}>
        <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM3.25 8.5h3.4V21h-3.4V8.5Zm5.96 0h3.26v1.71h.05c.45-.86 1.56-1.77 3.22-1.77 3.44 0 4.08 2.27 4.08 5.22V21h-3.4v-5.53c0-1.32-.02-3.02-1.84-3.02-1.84 0-2.12 1.44-2.12 2.92V21h-3.4V8.5Z" />
    </svg>
  );
}

export default function SiteFooter() {
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
            <div className="footer-socials">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <SocialIcon icon={s.icon} />
                </a>
              ))}
            </div>
            <span>&copy; 2026 Gate 15</span>
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
