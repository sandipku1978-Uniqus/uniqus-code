import Link from "next/link";

export const metadata = {
  title: "Support — Gate 15",
  description:
    "Help with Gate 15: getting started, account and billing, workspaces and previews, models and thinking, shipping your app, and troubleshooting.",
};

type Topic = {
  id: string;
  eyebrow: string;
  heading: string;
  blurb: string;
  faqs: { q: string; a: React.ReactNode }[];
};

const TOPICS: Topic[] = [
  {
    id: "getting-started",
    eyebrow: "Getting started",
    heading: "Your first project.",
    blurb:
      "Describe what you want, pick the AI you trust, and watch it come to life in a live preview. Here's how the first few minutes go.",
    faqs: [
      {
        q: "How do I start building?",
        a: (
          <>
            Type a plain-English description of what you want — &ldquo;an internal
            tool that tracks support tickets,&rdquo; for example — and the agent
            spins up a private workspace, writes a plan, and starts building. You
            don&rsquo;t need to scaffold anything yourself. See the{" "}
            <Link href="/docs">docs</Link> for a full walkthrough.
          </>
        ),
      },
      {
        q: "Do I need an account to try it?",
        a: (
          <>
            No. You can start as a guest and the session is tied to this browser while
            your projects are stored securely — save the one-time recovery code from
            the guest banner to reopen them on another device or browser. When you create
            an account you can carry that guest project forward, so nothing is lost.
            Signing in also unlocks reopening projects across devices and multiple
            concurrent workspaces.
          </>
        ),
      },
      {
        q: "What is plan mode?",
        a: (
          <>
            Before the agent changes anything, it can investigate your codebase and
            lay out a plan in plain English — a &ldquo;what you&rsquo;ll get&rdquo;
            list and a wireframe up front, with every technical detail (files, steps,
            success criteria) one click away behind a &ldquo;Technical
            details&rdquo; toggle. It keeps the AI out in the open instead of
            silently rewriting your project. Plan is one of four permission modes —
            alongside Ask before edits, Auto-accept, and Full autonomy — and you can
            switch between them mid-conversation as the work changes shape.
          </>
        ),
      },
      {
        q: "How much does it cost to start?",
        a: (
          <>
            The Free plan is genuinely free, no credit card required — you get one
            private workspace at a time, Auto model routing, live preview, plan mode,
            and built-in web search. See <Link href="/pricing">pricing</Link> for what
            Team and Enterprise add.
          </>
        ),
      },
    ],
  },
  {
    id: "billing",
    eyebrow: "Account & billing",
    heading: "Plans, seats, and keys.",
    blurb:
      "How billing works, what happens when you add teammates, and how to bring your own model API keys.",
    faqs: [
      {
        q: "How do I get Team access?",
        a: (
          <>
            Team access is currently opened through assisted onboarding at $20 per
            active member per month. Contact us through the Enterprise page and
            we&rsquo;ll confirm seats, billing, and workspace setup with you.
          </>
        ),
      },
      {
        q: "Can I use my own model API keys?",
        a: (
          <>
            Yes, on every plan — Free included, as long as you&rsquo;ve signed up for a
            full account (guest sessions can&rsquo;t yet). Add your Anthropic, OpenAI, or
            Google key in Settings and that usage is billed by the provider directly.
            Your keys are encrypted at rest and are never displayed back in full or
            exposed to the agent.
          </>
        ),
      },
      {
        q: "What happens to my guest work if I sign up?",
        a: (
          <>
            Guest projects are stored securely, while access to the guest session is
            tied to this browser or your recovery code. When you create an account, you can
            bring that work forward so you can reopen it anywhere and
            keep iterating. Nothing is thrown away when you upgrade from guest to a full
            account.
          </>
        ),
      },
      {
        q: "How do I get a DPA, invoicing, or a discount?",
        a: (
          <>
            Enterprise customers can request a Data Processing Addendum, invoicing, and
            a security review. We also work with early-stage startups, nonprofits, and
            educators — tell us about your team through the{" "}
            <Link href="/enterprise">Enterprise page</Link>.
          </>
        ),
      },
    ],
  },
  {
    id: "workspaces",
    eyebrow: "Workspaces & previews",
    heading: "Running and previewing your app.",
    blurb:
      "Every project gets its own private virtual machine with a live preview. Here's how to run it and what to do when the preview is blank.",
    faqs: [
      {
        q: "How does the live preview work?",
        a: (
          <>
            Each project runs in its own isolated virtual machine. When the agent
            starts your dev server, the preview panel shows the running app and reloads
            as files change — so you see the real thing, not a mockup, while you build.
          </>
        ),
      },
      {
        q: "My preview is blank or shows a 502. What's wrong?",
        a: (
          <>
            That&rsquo;s almost always a dev server bound to <code>127.0.0.1</code>,
            which isn&rsquo;t reachable across the workspace boundary. Bind it to{" "}
            <code>0.0.0.0</code> instead — most frameworks accept a{" "}
            <code>--host 0.0.0.0</code> flag or a <code>host</code> setting. Asking the
            agent to &ldquo;make the preview work&rdquo; will also nudge it to rebind
            for you.
          </>
        ),
      },
      {
        q: "What happens to a workspace when I'm not using it?",
        a: (
          <>
            Workspaces pause when idle and resume exactly where you left off, so you
            don&rsquo;t lose state between sessions. Your code and chat history stay
            with your account, and you can delete a project at any time to remove its
            sandbox and data.
          </>
        ),
      },
      {
        q: "Is one project's code visible to another?",
        a: (
          <>
            No. Each project gets a dedicated VM with its own filesystem and network
            boundary — not a shared container or browser tab. A runaway script or risky
            command in one project can&rsquo;t reach another.
          </>
        ),
      },
    ],
  },
  {
    id: "models",
    eyebrow: "Models & thinking",
    heading: "Picking the right AI.",
    blurb:
      "Choose Claude, GPT, Gemini, or GLM per turn, let Auto route for you, and dial how hard the model thinks.",
    faqs: [
      {
        q: "Which models can I use?",
        a: (
          <>
            You can pick from a curated list across four providers — Anthropic
            (Claude), Z.ai (GLM), OpenAI (GPT), and Google (Gemini) — in the
            composer&rsquo;s model picker, or set an account-wide default in Settings.
            The default is{" "}
            <strong>Auto</strong>, which sizes up each step and routes it to
            whichever configured model fits best — a fast model for a quick edit,
            a stronger reasoner for a hard problem — so you don&rsquo;t have to think
            about it.
          </>
        ),
      },
      {
        q: "What does the thinking-effort setting do?",
        a: (
          <>
            Thinking effort is a slider from low up through max — the exact rungs
            offered depend on the model you&rsquo;ve picked, since not every provider
            supports the very top end. Higher effort is better for tricky, multi-step
            changes; lower is faster for small edits. It&rsquo;s a per-turn control in the
            model picker with a default in Settings, and it applies across all four
            providers.
          </>
        ),
      },
      {
        q: "Can the agent search the web?",
        a: (
          <>
            Yes — built-in web search is available on Claude, GPT, GLM, and the latest
            Gemini models, so the agent can pull in current docs and API details rather than
            guessing from memory. Searches show up as a clearly labeled step in the
            activity, and the system only advertises search when the model you picked
            actually supports it.
          </>
        ),
      },
      {
        q: "Do I need my own API key to switch models?",
        a: (
          <>
            No — every plan can pick any model on our shared keys, no setup required.
            Adding your own Anthropic, OpenAI, or Google key in Settings is optional; it
            just moves that provider&rsquo;s usage onto your own billing instead of ours.
            If a key is ever missing for a model you choose, you&rsquo;ll get a clear
            &ldquo;set X&rdquo; message for that turn only — the rest of your work keeps
            going.
          </>
        ),
      },
    ],
  },
  {
    id: "shipping",
    eyebrow: "Shipping & deploys",
    heading: "Getting your app out the door.",
    blurb:
      "Sync to GitHub, deploy with one click, and keep secrets safe — all on your terms, never automatic.",
    faqs: [
      {
        q: "How do I connect GitHub?",
        a: (
          <>
            Link your repository from the project, and Gate 15 keeps your workspace
            and GitHub in sync. Pushes are explicit actions you trigger — code never
            leaves your workspace until you say so.
          </>
        ),
      },
      {
        q: "How do deploys work?",
        a: (
          <>
            You can ship your app with a one-click deploy when it&rsquo;s ready. Like
            GitHub pushes, deploying is something you choose to do — the agent
            doesn&rsquo;t publish anything on its own. You stay in control of when your
            app goes live.
          </>
        ),
      },
      {
        q: "Where do I put API keys and other secrets?",
        a: (
          <>
            Add them as encrypted secrets in your project. The agent can use a secret
            through controlled tooling so your app works, but the raw value is never
            printed back into chat or exposed to the model. Keys are encrypted at rest.
          </>
        ),
      },
      {
        q: "Can I review changes before they're committed?",
        a: (
          <>
            Yes — plan mode lets you see what the agent intends to do, and anything
            destructive or hard to undo is flagged for your approval rather than pushed
            through quietly. Combined with checkpoints, you always have a way back.
          </>
        ),
      },
    ],
  },
  {
    id: "troubleshoot",
    eyebrow: "Troubleshooting",
    heading: "When something goes sideways.",
    blurb:
      "Most issues have a quick fix. Here are the ones we see most, and how to recover an experiment that didn't go to plan.",
    faqs: [
      {
        q: "An experiment broke my project — can I undo it?",
        a: (
          <>
            Yes. Projects save checkpoints as you work, so you can rewind to an earlier
            state if a change goes wrong — without losing the rest of your progress. Roll
            back to the last good point and try a different approach.
          </>
        ),
      },
      {
        q: "The agent seems stuck or confused. What can I do?",
        a: (
          <>
            Give it a more specific instruction, or switch to plan mode so you can steer
            the approach before it acts. Bumping thinking effort up toward high or max
            helps on gnarly, multi-step problems. You can also try a different model from
            the picker — each provider has its own strengths.
          </>
        ),
      },
      {
        q: "The preview won't load even though the build succeeded.",
        a: (
          <>
            Check that the dev server is bound to <code>0.0.0.0</code> rather than{" "}
            <code>127.0.0.1</code> — a localhost-only bind is the most common cause of a
            502 or an empty preview, because it isn&rsquo;t reachable from outside the
            VM. The activity log shows the exact command the server started with.
          </>
        ),
      },
      {
        q: "I still can't figure it out. Who do I ask?",
        a: (
          <>
            Reach out through the <Link href="/contact">contact page</Link> with your
            project and what you were trying to do. Sharing the plan, the failing step,
            and any error from the activity log helps us help you faster.
          </>
        ),
      },
    ],
  },
];

export default function SupportPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Support
          </span>
          <h1>
            How can <span className="grad">we help</span>?
          </h1>
          <p className="mk-lede">
            Answers to the questions builders ask most — from your first project to
            shipping it live. Browse a topic below, or read the guide for the full
            walkthrough.
          </p>
          <div className="mk-hero-cta">
            <Link href="/docs" className="btn-primary btn-lg">
              Read the docs
            </Link>
            <Link href="/contact" className="btn-secondary btn-lg">
              Contact us
            </Link>
          </div>
        </div>
      </section>

      <div className="mk-page wide">
        <div className="mk-doc-shell">
          <aside className="mk-toc" aria-label="Support topics">
            <div className="label-micro">Topics</div>
            {TOPICS.map((t) => (
              <a key={t.id} href={`#${t.id}`}>
                {t.eyebrow}
              </a>
            ))}
          </aside>

          <div>
            {TOPICS.map((topic) => (
              <section
                id={topic.id}
                key={topic.id}
                style={{ scrollMarginTop: 96, marginBottom: 56 }}
              >
                <div className="mk-section-head">
                  <span className="label-eyebrow">{topic.eyebrow}</span>
                  <h2>{topic.heading}</h2>
                  <p>{topic.blurb}</p>
                </div>
                <div className="faq-list">
                  {topic.faqs.map((item) => (
                    <details className="faq-item" key={item.q}>
                      <summary>{item.q}</summary>
                      <p className="faq-a">{item.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            ))}

            <article
              className="mk-card"
              style={{
                marginTop: 8,
                background:
                  "radial-gradient(80% 120% at 50% 0%, color-mix(in srgb, var(--brand-ember) 14%, transparent), transparent 60%), color-mix(in srgb, var(--mk-panel-solid) 86%, transparent)",
                borderColor: "var(--mk-line-strong)",
                textAlign: "center",
                alignItems: "center",
                padding: 36,
              }}
            >
              <h3 style={{ fontSize: 22 }}>Still stuck?</h3>
              <p style={{ maxWidth: "48ch", margin: "0 auto 20px" }}>
                If you couldn&rsquo;t find an answer here, we&rsquo;d love to help.
                Tell us what you&rsquo;re building and where you got stuck, and
                we&rsquo;ll get back to you.
              </p>
              <Link href="/contact" className="btn-primary">
                Contact support
              </Link>
            </article>
          </div>
        </div>
      </div>
    </>
  );
}
