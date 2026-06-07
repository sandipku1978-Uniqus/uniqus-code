import Link from "next/link";

export const metadata = {
  title: "Enterprise — Uniqus Code",
  description:
    "Give your teams a governed, secure way to build with AI. SSO, audit logs, dedicated capacity, SLAs, and a security review — on private, isolated workspaces.",
};

type Icon =
  | "sso"
  | "audit"
  | "vm"
  | "doc"
  | "billing"
  | "people"
  | "approve"
  | "isolate"
  | "key"
  | "deploy";

function EntIcon({ name }: { name: Icon }) {
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "sso":
      return (
        <svg {...p}>
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
          <path d="M12 14.5v2.5" />
        </svg>
      );
    case "audit":
      return (
        <svg {...p}>
          <path d="M5 3.5h14v17l-3-2-2 2-2-2-2 2-2-2-3 2Z" />
          <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
        </svg>
      );
    case "vm":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case "doc":
      return (
        <svg {...p}>
          <path d="M6 3h8l4 4v14H6Z" />
          <path d="M14 3v4h4" />
          <path d="M9 13l2 2 4-4" />
        </svg>
      );
    case "billing":
      return (
        <svg {...p}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="M3 9.5h18M7 14.5h4" />
        </svg>
      );
    case "people":
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path d="M16 6.5a3 3 0 0 1 0 5.6M17.5 19a5.2 5.2 0 0 0-3-4.7" />
        </svg>
      );
    case "approve":
      return (
        <svg {...p}>
          <path d="M3 12a9 9 0 1 1 9 9" />
          <path d="M3 17v4h4" />
          <path d="M8.5 12l2.5 2.5L16 9.5" />
        </svg>
      );
    case "isolate":
      return (
        <svg {...p}>
          <rect x="3" y="4.5" width="8" height="6.5" rx="1.5" />
          <rect x="13" y="4.5" width="8" height="6.5" rx="1.5" />
          <rect x="3" y="13" width="8" height="6.5" rx="1.5" />
          <rect x="13" y="13" width="8" height="6.5" rx="1.5" />
        </svg>
      );
    case "key":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="4" />
          <path d="M11 11l8 8M16 16l2-2M18 18l2-2" />
        </svg>
      );
    case "deploy":
      return (
        <svg {...p}>
          <path d="M12 3c4 2 6 5.5 6 9.5L12 18l-6-5.5C6 8.5 8 5 12 3Z" />
          <circle cx="12" cy="10" r="2" />
          <path d="M9 18l-2 3M15 18l2 3" />
        </svg>
      );
  }
}

const INTEGRATIONS = [
  "GitHub",
  "Vercel",
  "Stripe",
  "Supabase",
  "Anthropic",
  "OpenAI",
  "Google",
];

const VALUES: { icon: Icon; iconClass: string; title: string; body: string }[] = [
  {
    icon: "sso",
    iconClass: "grad",
    title: "SSO / SAML & SCIM",
    body: "Connect your identity provider for single sign-on, and provision or deprovision members automatically with SCIM. Onboarding and offboarding stay in lockstep with your directory.",
  },
  {
    icon: "audit",
    iconClass: "purple",
    title: "Audit logs & role-based access",
    body: "Every plan, deploy, and risky action is recorded with who did what and when. Roles let you decide who can build, who can ship, and who can manage billing and secrets.",
  },
  {
    icon: "vm",
    iconClass: "cyan",
    title: "Dedicated VM capacity & SLAs",
    body: "Reserve isolated virtual machines for your org so workspaces start fast under load, backed by uptime and support commitments written into your agreement.",
  },
  {
    icon: "doc",
    iconClass: "green",
    title: "DPA & security review",
    body: "We’ll complete your security questionnaire, sign a Data Processing Addendum, and walk your team through our architecture and isolation model.",
  },
  {
    icon: "billing",
    iconClass: "amber",
    title: "Volume billing & invoicing",
    body: "Consolidate every seat onto a single annual invoice with net payment terms and a PO workflow — no more per-card receipts scattered across teams.",
  },
  {
    icon: "people",
    iconClass: "",
    title: "Dedicated success manager",
    body: "A named point of contact who knows your rollout, helps your teams adopt the workflow, and brings your feedback straight into our roadmap.",
  },
];

const STATS = [
  { num: "1 VM", lbl: "per project — fully isolated, no shared tenancy" },
  { num: "3", lbl: "model providers: Claude, GPT & Gemini" },
  { num: "SSO", lbl: "SAML + SCIM with role-based access" },
  { num: "Plan-first", lbl: "the agent proposes before it changes anything" },
];

const ROWS: {
  icon: Icon;
  iconClass: string;
  eyebrow: string;
  title: string;
  body: string;
  checks: string[];
  flip?: boolean;
}[] = [
  {
    icon: "approve",
    iconClass: "grad",
    eyebrow: "Governance",
    title: "Plan before change, approve before ship",
    body: "The agent works in plan mode: it lays out exactly what it intends to do before touching a file, and anything destructive waits for a human. Reviews and deploys are explicit, recorded actions, never silent automation.",
    checks: [
      "Plans surfaced in-chat for every meaningful change",
      "Risky or irreversible steps gated on approval",
      "Full audit trail of plans, tool calls, and results",
    ],
  },
  {
    icon: "isolate",
    iconClass: "purple",
    eyebrow: "Isolation",
    title: "A private machine for every project",
    body: "Each project runs in its own virtual machine with a dedicated filesystem and network boundary — not a shared container or browser tab. A runaway script or risky command in one project can’t reach another team’s work.",
    checks: [
      "One isolated VM per project, walled off by default",
      "Secrets encrypted at rest, never shown back to the model",
      "Workspaces pause when idle and resume where you left off",
    ],
    flip: true,
  },
  {
    icon: "key",
    iconClass: "cyan",
    eyebrow: "Your providers",
    title: "Bring your own model keys",
    body: "Add your organization’s Anthropic, OpenAI, or Google API keys and route usage through your own accounts and contracts. Auto mode still picks the right model for each step — now on the providers you already trust.",
    checks: [
      "Per-org keys for Claude, GPT & Gemini",
      "Built-in web search across all three providers",
      "Set an account-wide default model and thinking effort",
    ],
  },
  {
    icon: "deploy",
    iconClass: "green",
    eyebrow: "Ship anywhere",
    title: "Deploy to the targets you already use",
    body: "Sync projects to GitHub and ship with one-click deploys to Vercel. Connect Stripe and Supabase as your apps grow. Nothing leaves a workspace until someone on your team triggers it.",
    checks: [
      "Two-way GitHub sync on your repos",
      "One-click deploys plus checkpoints and rewind history",
      "Connectors for Stripe, Supabase, and your existing stack",
    ],
    flip: true,
  },
];

export default function EnterprisePage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Enterprise
          </span>
          <h1>
            Ship internal tools at the speed of{" "}
            <span className="grad">your roadmap</span>.
          </h1>
          <p className="mk-lede">
            Give every team a governed, secure way to build with AI. Uniqus Code
            pairs Claude, GPT, and Gemini with private workspaces, plan-first
            guardrails, and the controls your security and IT teams expect.
          </p>
          <div className="mk-hero-cta">
            <Link href="/contact" className="btn-primary btn-lg">
              Book a demo
            </Link>
            <Link href="/security" className="btn-secondary btn-lg">
              Review our security
            </Link>
          </div>
        </div>
      </section>

      <section className="mk-page">
        <p className="logo-cloud-label">Works with the stack you already use</p>
        <div className="logo-cloud">
          {INTEGRATIONS.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Built for IT &amp; security</span>
          <h2>Controls your organization can stand behind.</h2>
          <p>
            Everything teams love about Uniqus Code, wrapped in the governance,
            provisioning, and accountability an enterprise rollout needs.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {VALUES.map((item) => (
            <article className="mk-card hover" key={item.title}>
              <span className={`mk-ic ${item.iconClass}`}>
                <EntIcon name={item.icon} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page">
        <div className="stat-grid">
          {STATS.map((s) => (
            <div className="stat" key={s.lbl}>
              <div className="num">{s.num}</div>
              <div className="lbl">{s.lbl}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head">
          <span className="label-eyebrow">How enterprises build</span>
          <h2>Built for how your teams actually work.</h2>
          <p>
            Speed without the surprises. Each project is governed, isolated, and
            shipped on your terms — with you in control at every gate.
          </p>
        </div>
        <div className="mk-rows">
          {ROWS.map((row) => (
            <div
              className={`mk-row${row.flip ? " flip" : ""}`}
              key={row.title}
            >
              <div>
                <span className="label-eyebrow">{row.eyebrow}</span>
                <h3>{row.title}</h3>
                <p>{row.body}</p>
                <ul className="mk-checks">
                  {row.checks.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div className="mk-row-art">
                <span className="mk-ic grad" style={{ width: 64, height: 64 }}>
                  <EntIcon name={row.icon} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-page narrow">
        <div
          className="mk-card"
          style={{ alignItems: "center", textAlign: "center", padding: 40 }}
        >
          <span className="label-eyebrow">Let&rsquo;s talk</span>
          <h2
            style={{
              margin: "12px 0 10px",
              fontSize: "clamp(26px, 3.2vw, 36px)",
              fontWeight: 650,
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
            }}
          >
            See Uniqus Code on your toughest internal project.
          </h2>
          <p
            style={{
              margin: "0 auto 24px",
              maxWidth: "54ch",
              color: "var(--mk-muted)",
              fontSize: 16,
              lineHeight: 1.65,
            }}
          >
            Tell us about your team and what you&rsquo;re trying to build. We&rsquo;ll
            walk through the workflow, the security model, and a rollout plan that
            fits your org — no slide deck required.
          </p>
          <div className="mk-hero-cta">
            <Link href="/contact" className="btn-primary btn-lg">
              Book a demo
            </Link>
            <Link href="/security" className="btn-ghost btn-lg">
              Read the security overview
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
