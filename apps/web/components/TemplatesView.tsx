"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { TEMPLATE_CATEGORIES } from "@/lib/templates";
import { TemplatePreview } from "./UiPreview";

/**
 * Templates tab on the projects dashboard. A curated, in-app gallery of working
 * starter apps. Clicking one feeds its first-brief `prompt` straight into the
 * same `createProjectFromBrief` path the home composer uses — a real project is
 * created, pre-seeded with that brief, and the workspace opens on it.
 *
 * The catalog (`TEMPLATE_CATEGORIES`) is the single source of truth shared with
 * the public marketing `/templates` page, so the two never drift. Cards reuse
 * the house `.template-card` so this tab reads as one product with the rest.
 *
 * `onUse` resolves by navigating away (the workspace), so it never returns on
 * the happy path; a rejection means creation failed — surface it and let the
 * user try another.
 */
export default function TemplatesView({
  onUse,
}: {
  onUse: (prompt: string) => Promise<void>;
}) {
  // Title of the template currently being turned into a project, or null. One
  // at a time: the clicked card shows "Creating…" and the rest disable so a
  // double-click can't spawn two projects mid-navigation.
  const [busyTitle, setBusyTitle] = useState<string | null>(null);

  async function use(title: string, prompt: string): Promise<void> {
    if (busyTitle) return;
    setBusyTitle(title);
    try {
      await onUse(prompt);
      // On success onUse navigates to the new workspace and this view unmounts,
      // so we don't clear busy here — leaving the card in its "Creating…" state
      // until the route change avoids a flicker back to the idle label.
    } catch (err) {
      toast.error(
        `Couldn't start that template: ${err instanceof Error ? err.message : String(err)}`,
      );
      setBusyTitle(null);
    }
  }

  return (
    <div className="dash-page tmpl-page">
      <span className="page-eyebrow">Gallery</span>
      <h1>
        Start from a <span className="grad">template</span>
      </h1>
      <p className="lede">
        Curated starter apps that actually run. Pick one and we&apos;ll create a
        real project pre-seeded with its first brief, then open the workspace —
        from there it&apos;s yours to reshape, the same as a project you describe
        from scratch.
      </p>

      {TEMPLATE_CATEGORIES.map((category) => (
        <section key={category.eyebrow} className="tmpl-section">
          <div className="section-title">
            <div className="head">
              <span className="eyebrow">{category.eyebrow}</span>
              <h2>{category.heading}</h2>
            </div>
            <span className="sub">{category.blurb}</span>
          </div>
          <div className="template-grid">
            {category.templates.map((t) => {
              const busy = busyTitle === t.title;
              return (
                <article key={t.title} className="template-card tmpl-card">
                  <div className={`template-thumb ${t.thumb}`}>
                    <TemplatePreview art={t.art} />
                  </div>
                  <div className="template-body">
                    <h3>{t.title}</h3>
                    <p>{t.desc}</p>
                    <div className="template-tags">
                      {t.tags.map((tag) => (
                        <span className="mk-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="tmpl-use"
                      onClick={() => void use(t.title, t.prompt)}
                      disabled={busyTitle !== null}
                      aria-busy={busy}
                      aria-label={`Use the ${t.title} template`}
                    >
                      {busy ? (
                        <>
                          <span className="ds-spinner" /> Creating…
                        </>
                      ) : (
                        <>Use this template →</>
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
