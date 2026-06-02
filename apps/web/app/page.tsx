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
          <a href="#how">How it works</a>
          <a href="#models">AI models</a>
          <a href="#workspaces">Workspaces</a>
          <a href="#trust">Trust</a>
          <a href="/guide">Guide</a>
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
              Build with <span className="grad">the AI you trust</span>.
            </h1>
            <p className="lede">
              An AI workspace for building real apps. Pick the AI you trust for each
              step — Claude, GPT, or Gemini — watch your app come to life with a live
              preview, and run every project in its own private, secure space.
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
            <span className="label-eyebrow">Your choice of AI</span>
            <h2>Pick the right AI for the job, step by step.</h2>
            <p className="sub">
              Auto mode picks the best AI for you. Prefer to choose yourself? Send a
              tricky rebuild, a quick design tweak, a big research task, or a careful
              plan to whichever AI fits best.
            </p>
          </div>
          <div className="model-console" aria-label="Model picker preview">
            <div className="console-head">
              <span>AI picker</span>
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

        <section className="band kvm-band" id="workspaces">
          <div className="kvm-visual" aria-hidden="true">
            <div className="rack-frame">
              <div className="rack-row">
                <span>your project</span>
                <strong>Workspace 01</strong>
              </div>
              <div className="rack-row active">
                <span>live preview</span>
                <strong>Workspace 02</strong>
              </div>
              <div className="rack-row">
                <span>saved &amp; reopened</span>
                <strong>Workspace 03</strong>
              </div>
              <div className="rack-footer">your work is saved safely between sessions</div>
            </div>
          </div>
          <div className="section-head">
            <span className="label-eyebrow">A private machine per project</span>
            <h2>Real machines for real builds.</h2>
            <p className="sub">
              Each project runs on its own private virtual machine — a secure,
              dedicated computer in the cloud, not a shared browser tab. Add the tools
              you need, run real databases, preview your app live, and try bold
              experiments without putting anything else at risk.
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
            <h2>Everything you need in one workspace.</h2>
            <p className="sub">
              Your code, a live preview, a clear history of every change, and a way out
              if you need one — all in one place.
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
            <span className="label-eyebrow">How it works</span>
            <h2>From idea to a live app without ever leaving the page.</h2>
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
              Uniqus Code keeps the AI out in the open: it shows its plan before making
              changes, backs up its facts, keeps your private keys encrypted, saves
              restore points, and only publishes when you say so.
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
  { k: "3 AI providers", v: "Anthropic, OpenAI, Google" },
  { k: "A machine per project", v: "Private and secure" },
  { k: "Launch-ready", v: "tested, previewed, live" },
];

const MARQUEE_ITEMS = [
  "Idea to app",
  "Plan mode",
  "Live preview",
  "Import your code",
  "Built-in web search",
  "Publish to the web",
  "Encrypted and private",
  "Rewind anytime",
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
    name: "Best AI for each task",
    body: "Let Uniqus automatically pick the best AI for planning and building.",
    active: true,
  },
  {
    provider: "Anthropic",
    name: "Claude Opus / Sonnet",
    body: "Deep planning, careful changes, and long, focused building sessions.",
  },
  {
    provider: "OpenAI",
    name: "GPT-5.x / Codex",
    body: "Complex problem-solving, writing code, and sticking with multi-step tasks.",
  },
  {
    provider: "Google",
    name: "Gemini",
    body: "Working through lots of information, research-heavy tasks, and fast turnarounds.",
  },
];

const KVM_POINTS = [
  {
    title: "A space of its own",
    body: "Your code, tools, and data stay walled off from every other project — nothing spills over.",
  },
  {
    title: "Pick up where you left off",
    body: "Reopen a project in seconds, with everything exactly the way you left it.",
  },
  {
    title: "A real computer, not a toy",
    body: "Install software, run databases, and start your app — just like you would on your own machine.",
  },
];

const FEATURES = [
  {
    kicker: "Plan",
    title: "It plans before it changes anything",
    body: "The AI looks things over without changing anything, lays out the steps it will take, and waits for your approval before touching a single file.",
    visual: "visual-plan",
  },
  {
    kicker: "Build",
    title: "Chat, files, and an editor in one place",
    body: "A single workspace turns plain-English requests into real changes to your project's files — and shows you exactly what happened.",
    visual: "visual-build",
  },
  {
    kicker: "Preview",
    title: "See your app come to life",
    body: "Launch your app and view it right next to your code, while the AI takes screenshots to check its own work.",
    visual: "visual-preview",
  },
  {
    kicker: "Search",
    title: "Built-in web search",
    body: "The AI can search the web whenever the answer depends on the latest, up-to-date information.",
    visual: "visual-search",
  },
  {
    kicker: "Customize",
    title: "Skills and design packs",
    body: "Guide the AI with reusable instructions, your own preferences, and hand-picked design styles.",
    visual: "visual-customize",
  },
  {
    kicker: "Ship",
    title: "Publish, save, and rewind",
    body: "Save your code to GitHub, publish your app to the web, and rewind to an earlier version whenever an experiment goes sideways.",
    visual: "visual-ship",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Describe what you want",
    body: "Start from a sentence, a screenshot, a zip file, or code you already have. The AI turns your goal into a clear plan.",
  },
  {
    num: "02",
    title: "Choose your AI",
    body: "Stay on Auto, or pick Claude, GPT, or Gemini for that step — and dial how hard it thinks from low to high.",
  },
  {
    num: "03",
    title: "Run it in a private workspace",
    body: "Your workspace installs everything it needs, edits files, starts a live preview, and tests the result — all on its own secure machine.",
  },
  {
    num: "04",
    title: "Review and go live",
    body: "Review what changed, where the facts came from, and the live preview. Then publish, save a restore point, or keep going.",
  },
];

const TRUST = [
  {
    title: "Your private keys stay secret",
    body: "Passwords and access keys are locked away with encryption and never shown back to the AI.",
  },
  {
    title: "Guardrails on risky moves",
    body: "Anything risky or hard to undo is flagged for your approval instead of being pushed through quietly.",
  },
  {
    title: "A clear record of everything",
    body: "Every plan, action, and result stays visible in your project, so you always know exactly what happened.",
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
      { label: "AI models", href: "#models" },
      { label: "Workspaces", href: "#workspaces" },
      { label: "How it works", href: "#how" },
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
