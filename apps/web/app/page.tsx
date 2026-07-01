import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import BrandLockup from "@/components/BrandLockup";
import GuestBanner from "@/components/GuestBanner";
import LandingPrompt from "@/components/LandingPrompt";
import SiteFooter from "@/components/SiteFooter";
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
          <Link href="/pricing">Pricing</Link>
          <a href="#trust">Trust</a>
          <Link href="/docs">Docs</Link>
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
              step — Claude, GLM, GPT, or Gemini — watch your app come to life with a
              live preview, and run every project in its own private, secure space.
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
                <div className="feature-visual" aria-hidden="true">
                  <FeatureArt kind={feature.visual} />
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

          <SiteFooter />
        </section>
      </main>
    </div>
  );
}

// Meaningful mini-illustration per feature card. Each one literally depicts the
// capability (a checklist for Plan, chat + editor for Build, etc.) instead of
// the old abstract squares. Colours come from CSS classes (globals.css) so they
// stay theme-aware. preserveAspectRatio="meet" keeps the whole scene visible.
function FeatureArt({ kind }: { kind: string }) {
  const svgProps = {
    className: "feature-art",
    viewBox: "0 0 360 150",
    preserveAspectRatio: "xMidYMid meet",
    "aria-hidden": true as const,
  };

  switch (kind) {
    // Plan — a plan/checklist card: two approved steps, one still pending.
    case "visual-plan":
      return (
        <svg {...svgProps}>
          <rect className="fa-panel" x="92" y="20" width="176" height="110" rx="16" />
          <rect className="fa-stroke" x="92" y="20" width="176" height="110" rx="16" />
          <rect className="fa-line-soft" x="112" y="34" width="76" height="9" rx="4" />
          <circle className="fa-green" cx="120" cy="64" r="8" />
          <path className="fa-check" d="M116 64 l2.6 2.8 l5.4 -6.2" />
          <rect className="fa-line" x="138" y="60" width="104" height="8" rx="4" />
          <circle className="fa-green" cx="120" cy="88" r="8" />
          <path className="fa-check" d="M116 88 l2.6 2.8 l5.4 -6.2" />
          <rect className="fa-line" x="138" y="84" width="86" height="8" rx="4" />
          <circle className="fa-stroke" cx="120" cy="112" r="8" />
          <rect className="fa-line-soft" x="138" y="108" width="70" height="8" rx="4" />
        </svg>
      );

    // Build — a chat bubble next to a code editor with syntax-coloured lines.
    case "visual-build":
      return (
        <svg {...svgProps}>
          <rect className="fa-panel-2" x="24" y="32" width="118" height="80" rx="16" />
          <path className="fa-panel-2" d="M44 108 L44 128 L66 110 Z" />
          <rect className="fa-line" x="42" y="54" width="82" height="8" rx="4" />
          <rect className="fa-magenta" x="42" y="72" width="46" height="8" rx="4" />
          <rect className="fa-line-soft" x="94" y="72" width="30" height="8" rx="4" />
          <rect className="fa-panel" x="160" y="26" width="176" height="98" rx="14" />
          <rect className="fa-stroke" x="160" y="26" width="176" height="98" rx="14" />
          <line className="fa-stroke" x1="160" y1="50" x2="336" y2="50" />
          <circle className="fa-line" cx="174" cy="38" r="3" />
          <circle className="fa-line" cx="186" cy="38" r="3" />
          <circle className="fa-line" cx="198" cy="38" r="3" />
          <rect className="fa-magenta" x="172" y="62" width="38" height="7" rx="3.5" />
          <rect className="fa-line" x="216" y="62" width="64" height="7" rx="3.5" />
          <rect className="fa-purple-hi" x="184" y="78" width="50" height="7" rx="3.5" />
          <rect className="fa-line" x="240" y="78" width="40" height="7" rx="3.5" />
          <rect className="fa-line-soft" x="184" y="94" width="72" height="7" rx="3.5" />
          <rect className="fa-magenta" x="172" y="110" width="30" height="7" rx="3.5" />
        </svg>
      );

    // Preview — a browser window rendering an app, with a screenshot-capture badge.
    case "visual-preview":
      return (
        <svg {...svgProps}>
          <defs>
            <linearGradient id="faGradPrev" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="fa-grad-a" />
              <stop offset="1" className="fa-grad-b" />
            </linearGradient>
          </defs>
          <rect className="fa-panel" x="40" y="20" width="280" height="110" rx="14" />
          <rect className="fa-stroke" x="40" y="20" width="280" height="110" rx="14" />
          <circle className="fa-line" cx="58" cy="36" r="3.5" />
          <circle className="fa-line" cx="70" cy="36" r="3.5" />
          <circle className="fa-line" cx="82" cy="36" r="3.5" />
          <rect className="fa-line-soft" x="100" y="31" width="204" height="11" rx="5.5" />
          <line className="fa-stroke" x1="40" y1="52" x2="320" y2="52" />
          <rect fill="url(#faGradPrev)" x="58" y="64" width="116" height="54" rx="9" />
          <rect className="fa-line" x="188" y="66" width="112" height="9" rx="4.5" />
          <rect className="fa-line-soft" x="188" y="82" width="92" height="9" rx="4.5" />
          <rect className="fa-line-soft" x="188" y="98" width="74" height="9" rx="4.5" />
          <circle className="fa-panel-2" cx="300" cy="112" r="15" />
          <circle className="fa-stroke" cx="300" cy="112" r="15" />
          <circle className="fa-magenta" cx="300" cy="112" r="6" />
        </svg>
      );

    // Search — a search bar with a magnifying glass and a ranked result list.
    case "visual-search":
      return (
        <svg {...svgProps}>
          <rect className="fa-panel-2" x="46" y="30" width="268" height="36" rx="18" />
          <rect className="fa-stroke" x="46" y="30" width="268" height="36" rx="18" />
          <circle className="fa-icon" cx="72" cy="48" r="8" />
          <line className="fa-icon" x1="78" y1="54" x2="86" y2="62" />
          <rect className="fa-line" x="98" y="44" width="130" height="8" rx="4" />
          <rect className="fa-magenta" x="276" y="40" width="26" height="16" rx="8" />
          <circle className="fa-green" cx="64" cy="94" r="6" />
          <rect className="fa-line" x="80" y="90" width="150" height="8" rx="4" />
          <rect className="fa-line-soft" x="80" y="104" width="98" height="6" rx="3" />
          <circle className="fa-purple-hi" cx="64" cy="124" r="6" />
          <rect className="fa-line" x="80" y="120" width="126" height="8" rx="4" />
        </svg>
      );

    // Customize — a palette of design swatches above reusable "skill" chips.
    case "visual-customize":
      return (
        <svg {...svgProps}>
          <rect className="fa-magenta" x="67" y="26" width="46" height="46" rx="13" />
          <rect className="fa-purple-hi" x="127" y="26" width="46" height="46" rx="13" />
          <rect className="fa-purple" x="187" y="26" width="46" height="46" rx="13" />
          <rect className="fa-green" x="247" y="26" width="46" height="46" rx="13" />
          <rect className="fa-panel-2" x="67" y="90" width="112" height="26" rx="13" />
          <rect className="fa-stroke" x="67" y="90" width="112" height="26" rx="13" />
          <circle className="fa-magenta" cx="84" cy="103" r="4.5" />
          <rect className="fa-line" x="96" y="99" width="68" height="8" rx="4" />
          <rect className="fa-panel-2" x="187" y="90" width="106" height="26" rx="13" />
          <rect className="fa-stroke" x="187" y="90" width="106" height="26" rx="13" />
          <circle className="fa-green" cx="204" cy="103" r="4.5" />
          <rect className="fa-line" x="216" y="99" width="62" height="8" rx="4" />
        </svg>
      );

    // Ship — a "Publish" button above a version timeline with a rewind control.
    case "visual-ship":
      return (
        <svg {...svgProps}>
          <defs>
            <linearGradient id="faGradShip" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" className="fa-grad-a" />
              <stop offset="1" className="fa-grad-b" />
            </linearGradient>
          </defs>
          <rect fill="url(#faGradShip)" x="98" y="26" width="164" height="36" rx="18" />
          <path
            className="fa-icon"
            style={{ stroke: "rgba(255,255,255,0.95)" }}
            d="M122 52 L122 38 M115 45 L122 38 L129 45"
          />
          <rect className="fa-on-grad" x="142" y="40" width="96" height="8" rx="4" />
          <path className="fa-purple-hi" d="M58 99 L46 106 L58 113 Z" />
          <path className="fa-purple-hi" d="M46 99 L34 106 L46 113 Z" />
          <rect className="fa-line-soft" x="70" y="104" width="220" height="4" rx="2" />
          <circle className="fa-stroke" cx="92" cy="106" r="11" />
          <circle className="fa-green" cx="92" cy="106" r="7" />
          <circle className="fa-line" cx="148" cy="106" r="7" />
          <circle className="fa-line" cx="204" cy="106" r="7" />
          <circle className="fa-line" cx="260" cy="106" r="7" />
        </svg>
      );

    default:
      return null;
  }
}

const HERO_PROOF = [
  { k: "4 AI providers", v: "Anthropic, Z.ai, OpenAI, Google" },
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
    provider: "Z.ai",
    name: "GLM-5.2",
    body: "Near-Opus coding quality at a fraction of the cost, with a 1M-token context.",
  },
  {
    provider: "OpenAI",
    name: "GPT-5.5 / GPT-5.3 Codex",
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
    body: "Stay on Auto, or pick Claude, GLM, GPT, or Gemini for that step — and dial how hard it thinks from low to high.",
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

