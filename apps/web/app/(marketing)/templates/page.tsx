import Link from "next/link";
import TemplateCta from "./TemplateCta";
import { TEMPLATE_CATEGORIES } from "@/lib/templates";
import { TemplatePreview } from "@/components/UiPreview";

export const metadata = {
  title: "Templates — Uniqus Code",
  description:
    "Start from a governed template for finance, GRC, audit, and internal operations. Open any starting point in its own private, isolated workspace, then describe what to change and watch the AI build it live — with plan-approval and rewind built in.",
};

const CATEGORIES = TEMPLATE_CATEGORIES;

export default function TemplatesPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Templates
          </span>
          <h1>
            Start from a <span className="grad">governed template</span>.
          </h1>
          <p className="mk-lede">
            Control registers, approval workflows, audit evidence logs — the
            finance, GRC, and internal tools your team actually runs on. Each one
            opens in its own private, isolated workspace with plan-approval and
            rewind built in. Pick a starting point and describe what to change;
            the AI you trust rebuilds it live.
          </p>
          <div className="mk-hero-cta">
            <Link href="/login" className="btn-primary btn-lg">
              Start from a template
            </Link>
            <Link href="/guide" className="btn-secondary btn-lg">
              How it works
            </Link>
          </div>
        </div>
      </section>

      {CATEGORIES.map((category) => (
        <section className="mk-page wide" key={category.eyebrow}>
          <div className="mk-section-head">
            <span className="label-eyebrow">{category.eyebrow}</span>
            <h2>{category.heading}</h2>
            <p>{category.blurb}</p>
          </div>
          <div className="template-grid">
            {category.templates.map((t) => (
              <article className="template-card" key={t.title}>
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
                  <TemplateCta
                    prompt={t.prompt}
                    className="btn-ghost"
                    style={{ marginTop: 16, alignSelf: "flex-start" }}
                  >
                    Use this template →
                  </TemplateCta>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="mk-page narrow">
        <div className="mk-prose">
          <h2>Templates are a head start, not a cage</h2>
          <p>
            Every template opens as a real project in its own isolated VM — the
            same private workspace you&rsquo;d get from scratch, just with the
            boring scaffolding done. From there it&rsquo;s yours: ask for a new
            screen, swap the data model, change the look, or wire in a service.
            The agent plans the change, you watch it build in the live preview,
            and you can rewind any step that goes sideways.
          </p>
          <p>
            Don&rsquo;t see the one you want?{" "}
            <Link href="/login">Just describe it</Link> — Uniqus Code can build
            an app from a blank prompt every bit as well as from a starting
            point.
          </p>
        </div>
      </section>
    </>
  );
}
