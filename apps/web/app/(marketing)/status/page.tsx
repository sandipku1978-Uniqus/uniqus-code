import Link from "next/link";

export const metadata = {
  title: "System status — Gate 15",
  description:
    "A current snapshot of Gate 15 service health: the web app, orchestrator API, workspaces, model routing, live previews, deploys, and GitHub sync.",
};

const LAST_CHECKED = "July 2026";

const COMPONENTS = [
  { name: "Web app", note: "Dashboard, editor, and marketing site" },
  { name: "Orchestrator API", note: "Project sessions and the agent loop" },
  { name: "Workspaces (VMs)", note: "Private per-project isolated sandboxes" },
  { name: "Model routing — Anthropic", note: "Claude models and Auto routing" },
  { name: "Model routing — Z.ai", note: "GLM models and the vision bridge" },
  { name: "Model routing — OpenAI", note: "GPT models via the Responses API" },
  { name: "Model routing — Google", note: "Gemini models and grounding" },
  { name: "Live previews", note: "In-browser preview of your running app" },
  { name: "Deploys", note: "One-click Vercel deploys" },
  { name: "GitHub sync", note: "Two-way sync with your repositories" },
];

export default function StatusPage() {
  return (
    <>
      <section className="mk-page narrow">
        <Link href="/support" className="mk-back">
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to support
        </Link>
        <div className="mk-section-head">
          <span className="mk-eyebrow">
            <span className="dot" /> Status
          </span>
          <h2>System status.</h2>
          <p>
            A current snapshot of how Gate 15 is running. We check these
            components by hand on a regular cadence — this page reflects the
            most recent review, not a live monitor.
          </p>
        </div>
      </section>

      <section className="mk-page narrow" style={{ paddingTop: 0 }}>
        <div className="status-banner">
          <span className="big-dot" aria-hidden="true" />
          <span>
            <strong>All systems operational</strong>
            <span>Last checked: {LAST_CHECKED}</span>
          </span>
        </div>

        <div className="status-list">
          {COMPONENTS.map((c) => (
            <div className="status-row" key={c.name}>
              <span className="status-name">
                <span className="status-dot ok" aria-hidden="true" />
                {c.name}
              </span>
              <span className="status-state ok">Operational</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-section-head">
          <span className="label-eyebrow">Uptime</span>
          <h2>Building our track record.</h2>
          <p>
            Gate 15 is pre-launch, so we don&rsquo;t have a public uptime
            history yet. Once we&rsquo;re generally available, this page will
            show real availability trends for each system above.
          </p>
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-prose">
          <h2>Staying in the loop</h2>
          <p>
            We don&rsquo;t run a continuous public dashboard yet, so the cleanest
            way to hear about planned maintenance or an incident is to ask us to
            keep you posted. Email{" "}
            <a href="mailto:status@gate15.dev">status@gate15.dev</a> and
            we&rsquo;ll add you to update notices.
          </p>
          <p>
            Seeing something off that this page doesn&rsquo;t reflect? Head over
            to <Link href="/support">Support</Link> and we&rsquo;ll dig in with
            you.
          </p>
        </div>
        <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="mailto:status@gate15.dev" className="btn-secondary">
            Subscribe to updates
          </a>
          <Link href="/support" className="btn-ghost">
            Get help
          </Link>
        </div>
      </section>
    </>
  );
}
