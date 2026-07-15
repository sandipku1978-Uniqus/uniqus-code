import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import Toaster from "@/components/Toaster";

// Archivo — an industrial grotesque from the signage lineage. It carries the
// uppercase, wide-tracked labels the brand leans on.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gate 15 — Build real apps with AI.",
  description:
    "Describe what you want to build, pick the AI you trust, and watch your app come to life.",
  icons: {
    icon: "/brand/gate15-mark.svg",
  },
};

/**
 * Apply the persisted Appearance prefs (Settings → Appearance) to <html>
 * before first paint, so a light-theme / compact user never sees a flash of
 * the dark/comfortable defaults. Reads the same localStorage keys the store
 * writes (`gate15.theme` / `gate15.density`). Defaults to dark/comfortable
 * when unset or unreadable. Kept inline + tiny so it runs synchronously in
 * <head> ahead of the stylesheet applying token overrides.
 */
const APPEARANCE_BOOTSTRAP = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("gate15.theme");d.dataset.theme=t==="light"?"light":"dark";var s=localStorage.getItem("gate15.density");d.dataset.density=s==="compact"?"compact":"comfortable";}catch(e){document.documentElement.dataset.theme="dark";document.documentElement.dataset.density="comfortable";}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
