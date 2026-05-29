import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
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
  title: "Uniqus Code — Engineering, on demand.",
  description: "AI engineering workbench from Uniqus.",
  icons: {
    icon: "/brand/uniqus-small-logo-color.png",
  },
};

/**
 * Apply the persisted Appearance prefs (Settings → Appearance) to <html>
 * before first paint, so a light-theme / compact user never sees a flash of
 * the dark/comfortable defaults. Reads the same localStorage keys the store
 * writes (`uniqus.theme` / `uniqus.density`). Defaults to dark/comfortable
 * when unset or unreadable. Kept inline + tiny so it runs synchronously in
 * <head> ahead of the stylesheet applying token overrides.
 */
const APPEARANCE_BOOTSTRAP = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("uniqus.theme");d.dataset.theme=t==="light"?"light":"dark";var s=localStorage.getItem("uniqus.density");d.dataset.density=s==="compact"?"compact":"comfortable";}catch(e){document.documentElement.dataset.theme="dark";document.documentElement.dataset.density="comfortable";}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${jetBrainsMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
