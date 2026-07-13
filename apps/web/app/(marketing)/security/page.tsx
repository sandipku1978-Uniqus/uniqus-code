import Link from "next/link";
import ArchitectureDiagram from "./ArchitectureDiagram";

export const metadata = {
  title: "Security — Gate 15",
  description:
    "How Gate 15 keeps your code, keys, and data safe: per-project isolation, encrypted secrets, guardrails on risky actions, and a clear audit trail.",
};

type Icon = "lock" | "shield" | "vm" | "eye" | "key" | "history";

function PracticeIcon({ name }: { name: Icon }) {
  const p = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "lock":
      return (
        <svg {...p}>
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...p}>
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "vm":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case "eye":
      return (
        <svg {...p}>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "key":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="4" />
          <path d="M11 11l8 8M16 16l2-2M18 18l2-2" />
        </svg>
      );
    case "history":
      return (
        <svg {...p}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 4v4h4M12 8v4l3 2" />
        </svg>
      );
  }
}

const PRACTICES: { icon: Icon; iconClass: string; title: string; body: string }[] = [
  {
    icon: "vm",
    iconClass: "grad",
    title: "A private machine per project",
    body: "Every project runs in its own isolated virtual machine — not a shared container or browser tab. Your code, dependencies, and data stay walled off from every other project.",
  },
  {
    icon: "key",
    iconClass: "purple",
    title: "Secrets stay encrypted",
    body: "API keys and tokens are encrypted at rest. The agent can use a secret through controlled tooling, but the raw value is never printed back into chat or exposed to the model.",
  },
  {
    icon: "shield",
    iconClass: "cyan",
    title: "Guardrails on risky moves",
    body: "By default, anything destructive or hard to undo is flagged for your approval instead of being pushed through quietly. Four permission modes — Plan, Ask before edits, Auto-accept, and Full autonomy — let you dial in how much the agent can do without checking in, and you can switch modes mid-conversation.",
  },
  {
    icon: "eye",
    iconClass: "green",
    title: "A clear audit trail",
    body: "Every plan, tool call, and result stays visible in your project. You can always see exactly what the agent did, when, and why.",
  },
  {
    icon: "history",
    iconClass: "amber",
    title: "Checkpoints & rewind",
    body: "Projects save restore points as you work, so you can roll back to an earlier state if an experiment goes sideways — without losing the rest of your progress.",
  },
  {
    icon: "lock",
    iconClass: "",
    title: "You decide when to publish",
    body: "Nothing leaves your workspace until you say so. Deploys and GitHub pushes are explicit actions you trigger — never automatic.",
  },
];

const STATS = [
  { num: "1 VM", lbl: "per project — fully isolated" },
  { num: "AES-256", lbl: "encryption for secrets at rest" },
  { num: "TLS 1.3", lbl: "in transit, everywhere" },
  { num: "0", lbl: "secret values shown back to the model" },
];

const FAQ = [
  {
    q: "Who can see my code?",
    a: "Your projects are private to your account and the teammates you invite. Each project runs in an isolated VM, and we don't use your private code to train models.",
  },
  {
    q: "How are my model API keys handled?",
    a: "Keys you add in Settings are encrypted at rest and used only to make requests on your behalf. They're never displayed back to you in full and never exposed to the agent.",
  },
  {
    q: "Can I request a security review or DPA?",
    a: "Yes. Enterprise customers can request a security questionnaire, a Data Processing Addendum, and a review of our architecture. Reach out through the Enterprise page.",
  },
  {
    q: "What happens to a workspace when I close a project?",
    a: "Workspaces pause when idle and resume exactly where you left off. You can delete a project at any time, which removes its sandbox and associated data.",
  },
  {
    q: "Who are your sub-processors?",
    a: "Anthropic, Z.ai, OpenAI, and Google process model requests; Vercel hosts the web app, and our own infrastructure runs the orchestrator and each project's isolated sandbox; Supabase is our database; and WorkOS handles authentication and SSO. We only use a provider when the feature you've turned on requires it — for example, your turn only reaches Z.ai, OpenAI, or Google if you select one of their models.",
  },
  {
    q: "How is my data encrypted?",
    a: "In transit, everything is TLS 1.3. At rest, project secrets and stored OAuth tokens (GitHub, Vercel, and the like) are encrypted with AES-256-GCM before they ever touch the database — the database never sees plaintext.",
  },
  {
    q: "How long do you keep my data?",
    a: "Your data lives for the life of the project and account so you can reopen work across sessions and devices. When you delete a project or account, its sandbox, secrets, audit events, and messages are hard-deleted via database cascade. To be candid: there is no time-based auto-purge today — data persists until you delete it.",
  },
  {
    q: "How does the agent use a secret without seeing it?",
    a: "Provider and connector secrets are decrypted only server-side, inside the orchestrator, and written directly into your sandbox's .env file. The AI agent receives just the env-var name and a confirmation — never the plaintext value. Your code reads it from process.env at runtime, so the secret never enters the model's context.",
  },
  {
    q: "Is there an audit trail?",
    a: "Yes. We record an audit event for secret reads and writes, connector invocations, and checkpoint create/restore — each scoped to a project. You can review the trail per project today. An organization-wide audit view and a dedicated UI viewer are on the roadmap.",
  },
  {
    q: "Are you SOC 2 or ISO 27001 certified?",
    a: "Not yet — these certifications are on our roadmap, and we won't claim them until they're complete. In the meantime we're happy to walk enterprise teams through our architecture, isolation model, and controls, and to complete a security questionnaire and DPA.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Trust &amp; security
          </span>
          <h1>
            Fast doesn&rsquo;t have to mean <span className="grad">reckless</span>.
          </h1>
          <p className="mk-lede">
            Gate 15 keeps the AI out in the open. It shows its plan before
            making changes, keeps your keys encrypted, isolates every project,
            and only publishes when you say so.
          </p>
          <div className="mk-hero-cta">
            <Link href="/enterprise" className="btn-primary btn-lg">
              Talk to us about security
            </Link>
          </div>
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
          <span className="label-eyebrow">How we protect your work</span>
          <h2>Security built into the workflow.</h2>
          <p>
            These aren&rsquo;t bolted-on settings — they&rsquo;re how the product
            works by default, on every project.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {PRACTICES.map((item) => (
            <article className="mk-card hover" key={item.title}>
              <span className={`mk-ic ${item.iconClass}`}>
                <PracticeIcon name={item.icon} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-prose">
          <h2>Our approach to your data</h2>
          <p>
            We collect the minimum we need to run your workspaces and your
            account. Project code and chat history live with your account so you
            can reopen work across sessions and devices. We do not sell your
            data, and we do not use your private project code to train models.
          </p>
          <h3>In transit and at rest</h3>
          <p>
            All traffic between your browser, our orchestrator, and your
            workspace is encrypted with modern TLS. Secrets such as API keys and
            tokens are encrypted at rest and decrypted only when needed to serve
            a request you initiated.
          </p>
          <h3>Isolation by design</h3>
          <p>
            Each project runs in its own isolated microVM with a dedicated
            filesystem and sandbox. The in-VM agent requires a per-project token,
            and VM-to-VM traffic across the shared egress bridge is dropped &mdash;
            so a bug, a runaway script, or a risky command in one project
            can&rsquo;t reach another project&rsquo;s machine. Mutable state is
            scoped to the VM that owns it.
          </p>
          <h3>Responsible disclosure</h3>
          <p>
            Found a vulnerability? We want to hear about it. Email{" "}
            <a href="mailto:security@gate15.dev">security@gate15.dev</a> with the
            details and steps to reproduce, and we&rsquo;ll get back to you. We
            ask that you give us reasonable time to investigate and remediate
            before any public disclosure.
          </p>
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-section-head center">
          <span className="label-eyebrow">How it works</span>
          <h2>What happens to a request.</h2>
          <p>
            From your browser to the model and back, here&rsquo;s the path your
            code and secrets take — and where the boundaries sit.
          </p>
        </div>
        <ArchitectureDiagram />
      </section>

      <section className="mk-page narrow">
        <div className="mk-section-head center">
          <span className="label-eyebrow">FAQ</span>
          <h2>Security questions.</h2>
        </div>
        <div className="faq-list">
          {FAQ.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p className="faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
