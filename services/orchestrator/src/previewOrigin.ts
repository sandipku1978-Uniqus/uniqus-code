export function assertPreviewOriginConfigured(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  if (!env.PREVIEW_BASE_URL) {
    throw new Error(
      "PREVIEW_BASE_URL is required in production and must point at the dedicated cookieless preview origin.",
    );
  }
  if (!env.PUBLIC_BASE_URL) {
    throw new Error(
      "PUBLIC_BASE_URL is required in production for authenticated API and OAuth callback URLs.",
    );
  }
  const preview = new URL(env.PREVIEW_BASE_URL);
  const publicOrigin = new URL(env.PUBLIC_BASE_URL).origin;
  if (preview.origin === publicOrigin) {
    throw new Error("PREVIEW_BASE_URL must not be the orchestrator API origin");
  }
  const cookieDomain = (env.WORKOS_COOKIE_DOMAIN ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (!cookieDomain) {
    throw new Error("WORKOS_COOKIE_DOMAIN is required to verify preview cookie isolation");
  }
  const previewHostname = preview.hostname.toLowerCase();
  if (previewHostname === cookieDomain || previewHostname.endsWith(`.${cookieDomain}`)) {
    throw new Error(
      "PREVIEW_BASE_URL must be outside WORKOS_COOKIE_DOMAIN so application cookies cannot reach previews",
    );
  }
}
