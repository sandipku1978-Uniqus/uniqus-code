"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { PENDING_BRIEF_KEY } from "@/components/LandingPrompt";

/**
 * "Use this template" CTA (D1). When the template carries a seed `prompt`, we
 * stash it in sessionStorage under the same key the landing composer uses, then
 * send the visitor to sign in — the dashboard (ProjectPicker) reads that key on
 * mount and drops the prompt into the describe box, so the choice survives the
 * auth round-trip. Templates without a prompt fall back to a plain link.
 */
export default function TemplateCta({
  prompt,
  className,
  style,
  children,
}: {
  prompt?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const router = useRouter();
  if (!prompt) {
    return (
      <Link href="/login" className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => {
        try {
          sessionStorage.setItem(PENDING_BRIEF_KEY, prompt);
        } catch {
          /* private mode — the prompt just won't carry over */
        }
        router.push("/login");
      }}
    >
      {children}
    </button>
  );
}
