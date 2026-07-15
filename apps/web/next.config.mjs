import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local development keeps one repo-root .env.local, but the web process must
// not inherit provider/orchestrator credentials it never uses. Vercel supplies
// its environment directly; this allowlist only scopes the local fallback.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env.local");
const WEB_ENV_ALLOWLIST = new Set([
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_COOKIE_DOMAIN",
  "WORKOS_COOKIE_MAX_AGE",
  "WORKOS_COOKIE_NAME",
  "WORKOS_COOKIE_SAMESITE",
  "WORKOS_CLAIM_TOKEN",
  "WORKOS_ENABLE_PKCE",
  "WORKOS_API_HOSTNAME",
  "WORKOS_API_HTTPS",
  "WORKOS_API_PORT",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "NEXT_PUBLIC_ORCHESTRATOR_URL",
  "NEXT_PUBLIC_WS_URL",
  "NEXT_PUBLIC_PREVIEW_URL",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
]);
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!WEB_ENV_ALLOWLIST.has(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gate15/api-types"],
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gate15.dev" }],
        destination: "https://gate15.dev/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "gate15.app" }],
        destination: "https://gate15.dev/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
