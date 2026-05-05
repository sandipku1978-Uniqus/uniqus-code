import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import BrandLockup from "@/components/BrandLockup";

export default async function MarketingPage() {
  // Auth-aware CTAs: signed-in visitors get sent to their dashboard, not the
  // sign-in page, otherwise we trap them in a loop after WorkOS callback.
  const { user } = await withAuth();
  const ctaHref = user ? "/projects" : "/login";
  const ctaPrimary = user ? "Open dashboard" : "Get started";
  const ctaHero = user ? "Open dashboard" : "Start a project";
  const ctaCta = user ? "Open dashboard" : "Start free";

  return (
    <div className="marketing-shell">
      {/* Topnav */}
      <nav className="topnav">
        <Link href="/" style={{ textDecoration: "none" }}>
          <BrandLockup />
        </Link>
        <div className="links">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#trust">Trust</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="right">
          {!user && (
            <Link href="/login" className="btn-ghost">
              Sign in
            </Link>
          )}
          <Link href={ctaHref} className="btn-primary">
            {ctaPrimary}
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-inner">
          <span className="eyebrow">
            <span className="dot" /> Private beta
          </span>
          <h1>
            Engineering, <span className="accent">on demand.</span>
          </h1>
          <p className="lede">
            Uniqus Code is the AI engineering workbench from the team behind{" "}
            <em>National&nbsp;Office. On Demand.</em> One agent reads your repo, writes the code,
            runs the tests, and cites the docs it used.
          </p>
          <div className="hero-cta">
            <Link href={ctaHref} className="btn-primary btn-lg">
              {ctaHero}
            </Link>
            <a href="#how" className="btn-secondary btn-lg">
              Take the tour
            </a>
          </div>
        </div>
      </section>

      {/* IDE preview */}
      <div className="ide-preview">
        <div className="ide-frame">
          <div className="ide-titlebar">
            <div className="lights">
              <span />
              <span />
              <span />
            </div>
            <div className="url">code.uniqus.com / acme-billing-portal</div>
            <span className="pill-mono" style={{ fontSize: 10 }}>
              main
            </span>
          </div>
          <div className="ide-body">
            <div className="ide-chat">
              <div className="chat-msg">
                <div className="who">
                  <span className="av">Y</span> You
                </div>
                <div className="body">
                  Add a webhook handler for <code>invoice.paid</code> and update the user&apos;s
                  plan in Postgres.
                </div>
              </div>
              <div className="chat-msg">
                <div className="who">
                  <span className="av agent">C</span> Codex
                </div>
                <div className="body">
                  Reading <code>lib/stripe.ts</code> and <code>prisma/schema.prisma</code>.
                  Drafting handler with signature verification, then a non-destructive migration.
                </div>
              </div>
              <div className="chat-msg">
                <div className="who">
                  <span className="av agent">C</span> Codex
                </div>
                <div className="body">
                  Created <code>app/api/webhooks/stripe/route.ts</code> and added the{" "}
                  <code>plan</code> column migration. 4/4 tests pass.
                </div>
              </div>
            </div>
            <pre className="ide-code">
              <span className="cm">{`// app/api/webhooks/stripe/route.ts`}</span>
              {"\n"}
              <span className="kw">import</span> {"{ headers } "}
              <span className="kw">from</span> <span className="str">{`'next/headers'`}</span>;{"\n"}
              <span className="kw">import</span> {"{ stripe } "}
              <span className="kw">from</span> <span className="str">{`'@/lib/stripe'`}</span>;
              {"\n"}
              <span className="kw">import</span> {"{ db } "}
              <span className="kw">from</span> <span className="str">{`'@/lib/db'`}</span>;{"\n\n"}
              <span className="kw">export async function</span> <span className="fn">POST</span>
              (req: Request) {"{\n"}
              {"  "}
              <span className="kw">const</span> sig = (<span className="kw">await</span> headers()).get(
              <span className="str">{`'stripe-signature'`}</span>)!;{"\n"}
              {"  "}
              <span className="kw">const</span> body = <span className="kw">await</span> req.text();
              {"\n"}
              {"  "}
              <span className="kw">const</span> event = stripe.webhooks.
              <span className="fn">constructEvent</span>(body, sig, env.WEBHOOK_SECRET);{"\n\n"}
              {"  "}
              <span className="kw">if</span> (event.type === <span className="str">{`'invoice.paid'`}</span>) {"{\n"}
              {"    "}
              <span className="kw">await</span> db.user.<span className="fn">update</span>({"{\n"}
              {"      "}where: {"{ stripeCustomerId: customer "}
              <span className="kw">as</span> string {"},\n"}
              {"      "}data: {"{ plan: "}
              <span className="str">{`'pro'`}</span>, renewedAt: <span className="kw">new</span>{" "}
              <span className="fn">Date</span>() {"},\n"}
              {"    });\n"}
              {"  }\n"}
              {"  "}
              <span className="kw">return</span> Response.<span className="fn">json</span>({"{ received: "}
              <span className="num">true</span> {"});\n"}
              {"}"}
            </pre>
          </div>
        </div>
      </div>

      {/* Features */}
      <section className="band" id="how">
        <div className="section-head">
          <span className="label-eyebrow">What&apos;s inside</span>
          <h2>An IDE that reads your code, then writes the rest.</h2>
          <p className="sub">
            A real workspace — chat, files, terminal, code, preview — wired to one agent that
            picks the right tool for the job.
          </p>
        </div>
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="ic" dangerouslySetInnerHTML={{ __html: f.icon }} />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Meet the agent */}
      <section className="band" id="features">
        <div className="section-head">
          <span className="label-eyebrow">Meet the agent</span>
          <h2>Codex. One agent, every part of your stack.</h2>
          <p className="sub">
            Built on Claude Sonnet 4.6 with Opus 4.7 for planning. Reads everything, cites
            everything, never ships the destructive change quietly.
          </p>
        </div>
        <div className="agent-grid">
          <div className="agent-quote">
            <p>
              &ldquo;I work the way a partner works on a memo. I read the source, check the docs,
              run the tests, and tell you what I&apos;m uncertain about. If a migration is
              destructive, I stop and ask.&rdquo;
            </p>
            <div className="byline">CODEX · ENGINEERING AGENT</div>
          </div>
          <div className="stack-matrix">
            {STACK.map((s) => (
              <div className="stack-cell" key={s.title}>
                <div className="cell-title">{s.title}</div>
                <div className="cell-body">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="band">
        <div className="section-head">
          <span className="label-eyebrow">The loop</span>
          <h2>Brief, branch, ship.</h2>
        </div>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.num}>
              <span className="num">{s.num}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="band" id="trust">
        <div className="section-head">
          <span className="label-eyebrow">Trust</span>
          <h2>Audit-grade, by default.</h2>
          <p className="sub">
            Built by a Big-4-trained team. The same controls we apply in financial reporting apply
            here.
          </p>
        </div>
        <div className="compare">
          {STATS.map((s) => (
            <div className="stat" key={s.num}>
              <div className="num">{s.num}</div>
              <div className="lbl">{s.lbl}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <div className="cta-band" id="pricing">
        <h2>Stop pasting code into chat windows.</h2>
        <p>Free for solo projects. Team plans from $20/seat/month. Enterprise on request.</p>
        <div style={{ display: "inline-flex", gap: 10 }}>
          <Link href={ctaHref} className="btn-primary btn-lg">
            {ctaCta}
          </Link>
          <a href="#" className="btn-secondary btn-lg">
            Talk to sales
          </a>
        </div>
      </div>

      <footer className="site-footer">
        <div className="row">
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <BrandLockup style={{ fontSize: 14 }} />
            <span style={{ color: "var(--text-dim)" }}>© 2026 Uniqus Consultech</span>
          </div>
          <div className="links">
            <a href="#">Status</a>
            <a href="#">Changelog</a>
            <a href="#">Security</a>
            <a href="#">Terms</a>
            <a href="#">Privacy</a>
            <a href="https://uniqus.com">uniqus.com ↗</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    title: "Chat that touches your repo",
    body: "Ask in plain English. The agent reads the actual files, proposes a diff, and runs the tests before handing it back. No copy-paste loop.",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  },
  {
    title: "Plan-mode review",
    body: "Opus drafts a structured plan before any code is touched. Edit it, approve it, then Sonnet executes — every step verified.",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  },
  {
    title: "Real terminal, real sandbox",
    body: "Every project boots into an isolated VM. npm install, pytest, psql — works exactly like local. Logs stream into the chat.",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  },
  {
    title: "Cross-device sync",
    body: "Files persist to Storage automatically. Pick up the same project from another laptop, your phone, or a fresh sandbox.",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  },
  {
    title: "Live preview",
    body: "Web apps render side-by-side as the agent edits. Sub-second hot reload. The agent can take a screenshot to close the perception loop.",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  },
  {
    title: "Built-in review",
    body: "Confidence shields flag judgment areas. Destructive migrations stop and ask. Every change cites the source it came from.",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  },
];

const STACK = [
  { title: "Frontend", body: "React, Next.js, Vue, Svelte" },
  { title: "Data", body: "Postgres, Prisma, DuckDB" },
  { title: "Auth & Payments", body: "OAuth, SAML, Stripe" },
  { title: "Infra", body: "Docker, Vercel, Fly" },
  { title: "Testing", body: "Vitest, Pytest, Playwright" },
  { title: "Domain", body: "Finance, audit, ESG" },
];

const STEPS = [
  {
    num: "01  Describe",
    title: "Tell it what you want.",
    body: "One sentence is enough. Paste a Linear ticket, a screenshot, or a Notion doc. Codex picks it apart and forms a plan before touching a file.",
  },
  {
    num: "02  Watch it work",
    title: "Files change. Tests run.",
    body: "Your IDE is mirrored on the right; the agent's stream of thought sits on the left. Stop it, redirect it, or take the keyboard back at any time.",
  },
  {
    num: "03  Review & merge",
    title: "Diff with citations.",
    body: "Every change comes with a one-line rationale and the doc reference it used. Approve to push to your branch — never to main by default.",
  },
];

const STATS = [
  {
    num: "SOC 2 II",
    lbl: "Independently audited controls. Every action logged, every artifact retrievable for seven years.",
  },
  {
    num: "0 data train",
    lbl: "Your code is never used to train models. Sandboxes are wiped on disconnect; secrets stay in your vault.",
  },
  {
    num: "42 sec",
    lbl: "Median time from prompt to a passing test on our internal benchmark. P90 under three minutes.",
  },
];
