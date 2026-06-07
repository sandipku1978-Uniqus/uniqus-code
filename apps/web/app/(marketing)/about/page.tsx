import Link from "next/link";

export const metadata = {
  title: "About — Uniqus Code",
  description:
    "Uniqus Code exists to make building real software accessible — with an AI that shows its plan, cites its work, and runs every project on a real machine you control.",
};

type Icon = "eye" | "shield" | "open" | "craft" | "models" | "ship";

function ValueIcon({ name }: { name: Icon }) {
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
    case "eye":
      return (
        <svg {...p}>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...p}>
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "open":
      return (
        <svg {...p}>
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
          <path d="M8 10.5V7a4 4 0 0 1 7.5-1.9" />
        </svg>
      );
    case "craft":
      return (
        <svg {...p}>
          <path d="M14.5 4.5l5 5L9 20l-5 1 1-5L14.5 4.5Z" />
          <path d="M12.5 6.5l5 5" />
        </svg>
      );
    case "models":
      return (
        <svg {...p}>
          <circle cx="7" cy="7" r="3" />
          <circle cx="17" cy="7" r="3" />
          <circle cx="12" cy="17" r="3" />
          <path d="M9.4 8.8l-1 5M14.6 8.8l1 5" />
        </svg>
      );
    case "ship":
      return (
        <svg {...p}>
          <path d="M5 11l14-6-6 14-2.5-5.5L5 11Z" />
          <path d="M10.5 13.5l3-3" />
        </svg>
      );
  }
}

const VALUES: { icon: Icon; iconClass: string; title: string; body: string }[] = [
  {
    icon: "eye",
    iconClass: "grad",
    title: "Show your work",
    body: "The agent plans before it touches anything, cites what it looked up with built-in web search, and keeps every tool call visible. No black boxes — you can always see what it did and why.",
  },
  {
    icon: "shield",
    iconClass: "purple",
    title: "Trust by default",
    body: "Each project runs in its own private VM, secrets stay encrypted, and anything risky is flagged for your approval. Safety isn't a setting you switch on — it's how the product works.",
  },
  {
    icon: "open",
    iconClass: "cyan",
    title: "Build in the open",
    body: "You stay in control of every step. Plans are yours to approve, edit, or reject; nothing deploys or pushes to GitHub until you say so. The AI is a collaborator, not an autopilot.",
  },
  {
    icon: "craft",
    iconClass: "green",
    title: "Craft over hype",
    body: "We'd rather ship one feature that genuinely works than a demo that falls apart on the second prompt. We verify against current provider docs and fix root causes, not symptoms.",
  },
  {
    icon: "models",
    iconClass: "amber",
    title: "Your choice of AI",
    body: "Claude, GPT, and Gemini all live in the same workspace. Pick the model you trust for the job, or let Auto route each step to the right one. You're never locked into a single provider.",
  },
  {
    icon: "ship",
    iconClass: "",
    title: "Ship, don't stall",
    body: "Ideas are cheap; getting to something real is the hard part. A live preview, one-click deploys, and checkpoints to rewind from mean you keep moving instead of getting stuck.",
  },
];

const STATS = [
  { num: "3 AI", lbl: "providers in one workspace — Claude, GPT, Gemini" },
  { num: "1 VM", lbl: "per project — a real, isolated machine" },
  { num: "Plan-first", lbl: "the agent shows its plan before it builds" },
  { num: "You ship", lbl: "deploys and pushes happen only when you say so" },
];

export default function AboutPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> About
          </span>
          <h1>
            Software should be buildable by{" "}
            <span className="grad">anyone with an idea</span>.
          </h1>
          <p className="mk-lede">
            Uniqus Code is an AI workspace for building real apps. Describe what
            you want, pick the AI you trust, and watch it come to life in a
            private, isolated space with a live preview — with the AI working
            out in the open the whole way.
          </p>
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-prose">
          <h2>Why we built it</h2>
          <p>
            For most people with a good idea, the gap between &ldquo;I know what
            I want&rdquo; and a working app has always been enormous. You needed
            to set up a machine, learn a stack, wire up a dozen services, and
            keep it all running. AI changed what&rsquo;s possible — but a chat
            box that hands back a wall of code you can&rsquo;t run, can&rsquo;t
            see, and can&rsquo;t trust isn&rsquo;t the answer. We built Uniqus
            Code to close that gap properly.
          </p>
          <p>
            So we gave every project a real machine. Not a shared container or a
            disposable browser tab — its own private virtual machine, with a real
            filesystem, real dependencies, and a live preview you can open and
            click through. The AI builds in that machine the way an engineer
            would, and you watch it happen.
          </p>
          <p>
            We also refused to make the AI a black box. It shows its plan before
            it changes anything, cites what it looked up when it searches the web,
            and keeps every tool call and result visible. You choose the model you
            trust for each step — Claude, GPT, or Gemini — and nothing deploys or
            pushes to GitHub until you decide it should. The result is software you
            can actually understand and stand behind, not output you have to take
            on faith.
          </p>
          <p>
            Uniqus Code is built by{" "}
            <strong>Uniqus Consultech</strong>, with a simple conviction: the
            people closest to a problem should be able to build the tool that
            solves it. We&rsquo;re here to make that real.
          </p>
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head">
          <span className="label-eyebrow">What we believe</span>
          <h2>The principles we build on.</h2>
          <p>
            These aren&rsquo;t posters on a wall — they&rsquo;re the decisions
            baked into how the product behaves on every project.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {VALUES.map((v) => (
            <article className="mk-card hover" key={v.title}>
              <span className={`mk-ic ${v.iconClass}`}>
                <ValueIcon name={v.icon} />
              </span>
              <h3>{v.title}</h3>
              <p>{v.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">How it actually works</span>
          <h2>Real machines, in the open, your way.</h2>
        </div>
        <div className="stat-grid">
          {STATS.map((s) => (
            <div className="stat" key={s.lbl}>
              <div className="num">{s.num}</div>
              <div className="lbl">{s.lbl}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-grid cols-2">
          <article className="mk-card hover">
            <h3>Come build with us</h3>
            <p style={{ marginBottom: 18 }}>
              We&rsquo;re a small team obsessed with making building feel
              effortless without ever feeling like a black box. If that sounds
              like your kind of work, we&rsquo;re hiring.
            </p>
            <div className="mk-card-foot">
              <Link href="/careers" className="btn-secondary">
                See open roles
              </Link>
            </div>
          </article>
          <article className="mk-card hover">
            <h3>Want to talk?</h3>
            <p style={{ marginBottom: 18 }}>
              Questions about the product, a partnership, or how Uniqus Code
              could work for your team? We read every message and would love to
              hear from you.
            </p>
            <div className="mk-card-foot">
              <Link href="/contact" className="btn-secondary">
                Get in touch
              </Link>
            </div>
          </article>
        </div>
      </section>
    </>
  );
}
