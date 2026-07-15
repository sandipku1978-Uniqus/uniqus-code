const sourceOrigin = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
};

export function buildContentSecurityPolicy(
  nonce: string,
  production = process.env.NODE_ENV === "production",
): string {
  const apiOrigin = sourceOrigin(process.env.NEXT_PUBLIC_ORCHESTRATOR_URL);
  const previewOrigin = sourceOrigin(process.env.NEXT_PUBLIC_PREVIEW_URL);
  const connectSources = new Set(["'self'", "https://challenges.cloudflare.com"]);
  if (apiOrigin) {
    connectSources.add(apiOrigin);
    connectSources.add(apiOrigin.replace(/^http/, "ws"));
  }
  const explicitWs = sourceOrigin(
    process.env.NEXT_PUBLIC_WS_URL?.replace(/^ws/, "http"),
  );
  if (explicitWs) connectSources.add(explicitWs.replace(/^http/, "ws"));

  const frameSources = new Set([
    "'self'",
    "blob:",
    "https://challenges.cloudflare.com",
  ]);
  if (previewOrigin) frameSources.add(previewOrigin);

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
  ];
  if (!production) scriptSources.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${[...connectSources].join(" ")}`,
    `frame-src ${[...frameSources].join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.workos.com https://api.workos.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function applySecurityHeaders(headers: Headers, csp: string): void {
  headers.set("Content-Security-Policy", csp);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  );
}
