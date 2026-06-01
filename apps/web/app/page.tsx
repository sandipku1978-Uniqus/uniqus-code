import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import BrandLockup from "@/components/BrandLockup";
import GuestBanner from "@/components/GuestBanner";
import LandingPrompt from "@/components/LandingPrompt";
import { getGuestSession } from "@/lib/guest-server";

export default async function MarketingPage() {
  // Auth-aware CTAs: signed-in visitors (WorkOS or guest) get sent to their
  // dashboard, not the sign-in page, otherwise we trap them in a loop after
  // the WorkOS callback.
  const { user } = await withAuth();
  const guest = user ? null : await getGuestSession();
  const signedIn = !!user || !!guest;
  const ctaHref = signedIn ? "/projects" : "/login";
  const ctaPrimary = signedIn ? "Open dashboard" : "Get started";
  const ctaHero = signedIn ? "Open dashboard" : "Start building";
  const ctaCta = signedIn ? "Open dashboard" : "Start free";

  return (
    <div className="marketing-shell">
      {guest && <GuestBanner />}
      <nav className="topnav marketing-nav">
        <Link href="/" className="brand-link">
          <BrandLockup />
        </Link>
        <div className="links">
          <a href="#how">Workflow</a>
          <a href="#models">Models</a>
          <a href="#kvms">KVMs</a>
          <a href="#trust">Trust</a>
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

      <main>
        <section className="hero">
          <div className="hero-aurora" aria-hidden="true">
            <span className="glow-top" />
            <span className="glow-box" />
            <span className="glow-bottom" />
          </div>

          <div className="hero-copy">
            <span className="eyebrow">
              <span className="dot" /> Private beta for serious builders
            </span>
            <h1>
              Build with <span className="grad">the model you trust</span>.
            </h1>
            <p className="lede">
              An AI app-building workspace with per-turn model choice — Claude, GPT,
              or Gemini — a real terminal, live preview, and an isolated Firecracker
              microVM for every project.
            </p>

            <LandingPrompt
              variant="hero"
              signedIn={signedIn}
              ctaHref={ctaHref}
              ctaLabel={ctaHero}
              placeholder="Ask Uniqus to build an internal tool that…"
              suggestions={HERO_SUGGESTIONS}
            />

            <div className="hero-cta">
              <a href="#models" className="hero-link">
                See the platform →
              </a>
            </div>

            <div className="hero-proof" aria-label="Platform highlights">
              {HERO_PROOF.map((item) => (
                <div key={item.k}>
                  <strong>{item.k}</strong>
                  <span>{item.v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="marquee-band" aria-label="Core platform capabilities">
          {MARQUEE_ITEMS.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </section>

        <section className="band split-band" id="models">
          <div className="section-head">
            <span className="label-eyebrow">Multi-provider model selection</span>
            <h2>Pick the brain for the job, turn by turn.</h2>
            <p className="sub">
              Auto mode keeps the best default ready. Advanced mode lets builders route a
              hard refactor, fast UI pass, long-context search, or careful plan to the
              model that fits.
            </p>
          </div>
          <div className="model-console" aria-label="Model picker preview">
            <div className="console-head">
              <span>advanced picker</span>
              <strong>thinking: high</strong>
            </div>
            <div className="model-card-grid">
              {MODELS.map((model) => (
                <div className={`model-card ${model.active ? "active" : ""}`} key={model.name}>
                  <span className="model-provider">{model.provider}</span>
                  <strong>{model.name}</strong>
                  <p>{model.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="band kvm-band" id="kvms">
          <div className="kvm-visual" aria-hidden="true">
            <div className="rack-frame">
              <div className="rack-row">
                <span>project vm</span>
                <strong>KVM 01</strong>
              </div>
              <div className="rack-row active">
                <span>preview server</span>
                <strong>KVM 02</strong>
              </div>
              <div className="rack-row">
                <span>restored snapshot</span>
                <strong>KVM 03</strong>
              </div>
              <div className="rack-footer">files sync to storage between runs</div>
            </div>
          </div>
          <div className="section-head">
            <span className="label-eyebrow">KVM-backed sandboxes</span>
            <h2>Real machines for real builds.</h2>
            <p className="sub">
              Each project runs in its own Firecracker microVM instead of a shared tab
              runtime. Install packages, run databases, start dev servers, and keep risky
              experiments contained.
            </p>
            <div className="kvm-points">
              {KVM_POINTS.map((point) => (
                <div key={point.title}>
                  <strong>{point.title}</strong>
                  <span>{point.body}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="band" id="features">
          <div className="section-head wide">
            <span className="label-eyebrow">What is inside</span>
            <h2>Everything wired into one workspace.</h2>
            <p className="sub">
              Code, runtime, review trail, and escape hatch in one builder surface.
            </p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article className="feature" key={feature.title}>
                <span className="feature-kicker">{feature.kicker}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <div className={`feature-visual ${feature.visual}`} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="band workflow-band" id="how">
          <div className="section-head wide">
            <span className="label-eyebrow">The loop</span>
            <h2>From prompt to preview to production without leaving the page.</h2>
          </div>
          <div className="steps">
            {STEPS.map((step) => (
              <div className="step" key={step.num}>
                <span className="num">{step.num}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="band trust-band" id="trust">
          <div className="section-head">
            <span className="label-eyebrow">Trust and control</span>
            <h2>Fast does not have to mean reckless.</h2>
            <p className="sub">
              Uniqus Code keeps the agent observable: plans before edits, citations in
              review, encrypted secrets, checkpoints, and deploys you approve.
            </p>
          </div>
          <div className="trust-grid">
            {TRUST.map((item) => (
              <div className="trust-card" key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bottom-build" id="pricing">
          <div className="bottom-build-inner">
            <span className="bottom-kicker">AI app builder</span>
            <h2>Ready to build?</h2>
            <LandingPrompt
              variant="bottom"
              signedIn={signedIn}
              ctaHref={ctaHref}
              ctaLabel={ctaHero}
              placeholder="Ask Uniqus to create a production-ready workspace for my team..."
            />
            <p className="bottom-note">
              Free for solo projects. Team plans from $20/seat/month. Enterprise on request.
            </p>
          </div>

          <footer className="site-footer">
            <div className="footer-panel">
              <div className="footer-brand-block">
                <BrandLockup style={{ fontSize: 14 }} />
                <span>&copy; 2026 Uniqus Consultech</span>
              </div>
              <div className="footer-columns">
                {FOOTER_COLUMNS.map((column) => (
                  <div className="footer-column" key={column.title}>
                    <h3>{column.title}</h3>
                    {column.links.map((link) => (
                      <a href={link.href} key={link.label}>
                        {link.label}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}

const HERO_PROOF = [
  { k: "3 providers", v: "Anthropic, OpenAI, Google" },
  { k: "KVM per project", v: "Firecracker isolation" },
  { k: "Ship-ready", v: "tests, preview, deploys" },
];

const MARQUEE_ITEMS = [
  "Prompt to app",
  "Plan mode",
  "Live preview",
  "GitHub import",
  "Vercel deploy",
  "Fly.io deploy",
  "Encrypted secrets",
  "Checkpoints",
  "Design packs",
];

const HERO_SUGGESTIONS = [
  "An internal admin tool",
  "A Stripe billing flow",
  "A customer CRM",
  "A marketing landing page",
];

const MODELS = [
  {
    provider: "Auto",
    name: "Best model per task",
    body: "Let Uniqus route planning and coding to the strongest sensible default.",
    active: true,
  },
  {
    provider: "Anthropic",
    name: "Claude Opus / Sonnet",
    body: "Deep planning, careful refactors, and long agentic coding sessions.",
  },
  {
    provider: "OpenAI",
    name: "GPT-5.x / Codex",
    body: "Complex reasoning, code generation, and durable tool-use loops.",
  },
  {
    provider: "Google",
    name: "Gemini",
    body: "Large-context analysis, search-heavy tasks, and fast iteration.",
  },
];

const KVM_POINTS = [
  {
    title: "Per-project isolation",
    body: "Code, installs, tests, and local services run away from every other workspace.",
  },
  {
    title: "Snapshot restore",
    body: "Reopen projects quickly while preserving the machine state that matters.",
  },
  {
    title: "Real terminal",
    body: "Use npm, pytest, psql, dev servers, and logs the way you would locally.",
  },
];

const FEATURES = [
  {
    kicker: "Plan",
    title: "Plan mode before edits",
    body: "The agent investigates with read-only tools, proposes steps, and waits for approval before touching files.",
    visual: "visual-plan",
  },
  {
    kicker: "Build",
    title: "Chat, files, editor, terminal",
    body: "A single workspace joins natural-language requests with real repo context and command output.",
    visual: "visual-build",
  },
  {
    kicker: "Preview",
    title: "Live app inspection",
    body: "Run the dev server, view the app beside the code, and let the agent capture screenshots to close the loop.",
    visual: "visual-preview",
  },
  {
    kicker: "Search",
    title: "Provider-native web search",
    body: "Use web search across supported providers when the answer depends on current docs or APIs.",
    visual: "visual-search",
  },
  {
    kicker: "Customize",
    title: "Skills and design packs",
    body: "Steer the agent with project skills, account prompts, and curated design guidance.",
    visual: "visual-customize",
  },
  {
    kicker: "Ship",
    title: "GitHub, deploys, checkpoints",
    body: "Create repos, deploy to Vercel or Fly.io, and rewind with checkpoints when an experiment goes sideways.",
    visual: "visual-ship",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Describe the product",
    body: "Start from a sentence, screenshot, zip, or GitHub repo. The agent turns the goal into a workable plan.",
  },
  {
    num: "02",
    title: "Choose the model",
    body: "Stay on Auto or pick Claude, GPT, or Gemini for that exact turn with low, medium, or high thinking.",
  },
  {
    num: "03",
    title: "Run it in a KVM",
    body: "The sandbox installs dependencies, edits files, starts previews, and runs tests inside its own microVM.",
  },
  {
    num: "04",
    title: "Review and ship",
    body: "Inspect the diff, citations, logs, and preview. Then deploy, checkpoint, or keep iterating.",
  },
];

const TRUST = [
  {
    title: "Encrypted secrets",
    body: "API keys and OAuth tokens are stored as sealed credentials and never returned to the model.",
  },
  {
    title: "Destructive-change guardrails",
    body: "Risky migrations and irreversible work are surfaced for review instead of quietly pushed through.",
  },
  {
    title: "Auditable work trail",
    body: "Plans, tool calls, command output, checkpoints, and deploy state stay visible in the project.",
  },
];

const FOOTER_COLUMNS = [
  {
    title: "Company",
    links: [
      { label: "uniqus.com", href: "https://uniqus.com" },
      { label: "Enterprise", href: "#trust" },
      { label: "Security", href: "#trust" },
      { label: "Trust center", href: "#trust" },
    ],
  },
  {
    title: "Product",
    links: [
      { label: "Models", href: "#models" },
      { label: "KVMs", href: "#kvms" },
      { label: "Workflow", href: "#how" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Guide", href: "/guide" },
      { label: "Projects", href: "/projects" },
      { label: "Templates", href: "#features" },
      { label: "Support", href: "https://uniqus.com" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "https://uniqus.com" },
      { label: "Terms", href: "https://uniqus.com" },
      { label: "Security", href: "#trust" },
      { label: "Report abuse", href: "https://uniqus.com" },
    ],
  },
];
