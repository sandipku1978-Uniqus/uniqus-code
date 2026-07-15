"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandLockup from "@/components/BrandLockup";
import NavExploreMenu from "@/components/NavExploreMenu";
import { FOOTER_COLUMNS } from "@/components/SiteFooter";

const ROUTE_LINKS = [
  { label: "Pricing", href: "/pricing" },
  { label: "AI models", href: "/models" },
  { label: "Workspaces", href: "/workspaces" },
  { label: "Enterprise", href: "/enterprise" },
  { label: "Docs", href: "/docs" },
] as const;

const LANDING_LINKS = [
  { label: "How it works", href: "#workflow" },
  { label: "AI models", href: "#models" },
  { label: "Private workspaces", href: "#workspaces" },
  { label: "Trust", href: "#trust" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
] as const;

function currentPage(pathname: string, href: string): "page" | undefined {
  if (!href.startsWith("/")) return undefined;
  return pathname === href ? "page" : undefined;
}

/** Shared public navigation for the landing page and every marketing route. */
export default function MarketingNav({
  signedIn,
  ctaHref,
  ctaLabel,
  variant = "routes",
  showSignIn = !signedIn,
}: {
  signedIn: boolean;
  ctaHref: string;
  ctaLabel: string;
  variant?: "routes" | "landing";
  showSignIn?: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const desktopLinks = variant === "landing" ? LANDING_LINKS : ROUTE_LINKS;
  const desktopRouteHrefs = desktopLinks
    .map((link) => link.href)
    .filter((href) => href.startsWith("/"));

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    menuRef.current?.querySelector<HTMLElement>("a[href]")?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMobileOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!navRef.current?.contains(event.target as Node)) setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [mobileOpen]);

  const closeMobile = (): void => setMobileOpen(false);

  return (
    <nav ref={navRef} className="topnav marketing-nav" aria-label="Primary">
      <Link href="/" className="brand-link" onClick={closeMobile}>
        <BrandLockup />
      </Link>

      <div className="links">
        {desktopLinks.map((link) =>
          link.href.startsWith("#") ? (
            <a href={link.href} key={link.href}>
              {link.label}
            </a>
          ) : (
            <Link
              href={link.href}
              key={link.href}
              aria-current={currentPage(pathname, link.href)}
            >
              {link.label}
            </Link>
          ),
        )}
        <NavExploreMenu excludeHrefs={desktopRouteHrefs} />
      </div>

      <div className="right">
        <button
          ref={triggerRef}
          type="button"
          className="marketing-mobile-trigger"
          aria-expanded={mobileOpen}
          aria-controls="marketing-mobile-menu"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
          Menu
        </button>
        {showSignIn && (
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
        )}
        <Link href={ctaHref} className="btn-primary">
          {ctaLabel}
        </Link>
      </div>

      {mobileOpen && (
        <div
          ref={menuRef}
          id="marketing-mobile-menu"
          className="marketing-mobile-menu"
        >
          {variant === "landing" && (
            <div className="marketing-mobile-group">
              <span>On this page</span>
              {LANDING_LINKS.filter((link) => link.href.startsWith("#")).map(
                (link) => (
                  <a href={link.href} key={link.href} onClick={closeMobile}>
                    {link.label}
                  </a>
                ),
              )}
            </div>
          )}
          {FOOTER_COLUMNS.filter((column) => column.title !== "Legal").map(
            (column) => (
              <div className="marketing-mobile-group" key={column.title}>
                <span>{column.title}</span>
                {column.links.map((link) => (
                  <Link
                    href={link.href}
                    key={link.href}
                    aria-current={currentPage(pathname, link.href)}
                    onClick={closeMobile}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ),
          )}
          {showSignIn && (
            <Link className="marketing-mobile-signin" href="/login" onClick={closeMobile}>
              Sign in
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
