import Link from "next/link";

export const metadata = {
  title: "Workspaces — Uniqus Code",
  description:
    "Every project runs on its own private virtual machine — a real, secure computer in the cloud. Install software, run real databases, see a live preview, and pick up exactly where you left off.",
};

const STATS = [
  { num: "1 VM", lbl: "per project — fully isolated" },
  { num: "Sub-second", lbl: "reopen on a warm project" },
  { num: "Live", lbl: "preview right next to your code" },
  { num: "Saved", lbl: "between sessions and devices" },
];

const INSIDE: { icon: InsideIcon; iconClass: string; title: string; body: string }[] = [
  {
    icon: "files",
    iconClass: "grad",
    title: "Files & editor",
    body: "The full project tree on a real filesystem. Browse, read, and edit any file — the agent writes here and you can too.",
  },
  {
    icon: "chat",
    iconClass: "purple",
    title: "Chat + plan mode",
    body: "Describe what you want in plain English. The agent drafts a plan you can review before it touches a single file.",
  },
  {
    icon: "terminal",
    iconClass: "cyan",
    title: "Logs & terminal output",
    body: "Watch real commands run — installs, builds, test runs, server logs — streamed straight from the machine, not faked.",
  },
  {
    icon: "key",
    iconClass: "green",
    title: "Secrets (encrypted)",
    body: "API keys and tokens are encrypted at rest. The agent can use them through controlled tooling, but raw values never leak back into chat.",
  },
  {
    icon: "skills",
    iconClass: "amber",
    title: "Skills & design packs",
    body: "Reusable skills and design packs come along for the ride, so the agent builds the way you want from the first prompt.",
  },
  {
    icon: "deploy",
    iconClass: "",
    title: "Deploy & GitHub",
    body: "Push to GitHub and ship to Vercel when you're ready. Both are explicit actions you trigger — never automatic.",
  },
];

type InsideIcon =
  | "files"
  | "chat"
  | "terminal"
  | "key"
  | "skills"
  | "deploy";

function InsideIcon({ name }: { name: InsideIcon }) {
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
    case "files":
      return (
        <svg {...p}>
          <path d="M4 5a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" />
        </svg>
      );
    case "chat":
      return (
        <svg {...p}>
          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V5Z" />
          <path d="M8 9h8M8 12.5h5" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9l3 3-3 3M13 15h4" />
        </svg>
      );
    case "key":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="4" />
          <path d="M11 11l8 8M16 16l2-2M18 18l2-2" />
        </svg>
      );
    case "skills":
      return (
        <svg {...p}>
          <path d="M12 3l2.2 4.6L19 8.3l-3.5 3.4.8 4.9L12 14.5 7.7 16.6l.8-4.9L5 8.3l4.8-.7L12 3Z" />
        </svg>
      );
    case "deploy":
      return (
        <svg {...p}>
          <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4Z" />
          <path d="M12 8v6M9 11l3-3 3 3" />
        </svg>
      );
  }
}

export default function WorkspacesPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Workspaces
          </span>
          <h1>
            Real machines for <span className="grad">real builds</span>.
          </h1>
          <p className="mk-lede">
            Every project runs on its own private virtual machine — a real,
            secure computer in the cloud, not a shared browser tab. Install
            software, run real databases, start your app, and watch it come to
            life in a live preview.
          </p>
          <div className="mk-hero-cta">
            <Link href="/login" className="btn-primary btn-lg">
              Start building
            </Link>
            <Link href="/security" className="btn-secondary btn-lg">
              How isolation works
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
        <div className="mk-section-head center">
          <span className="label-eyebrow">What a workspace gives you</span>
          <h2>A computer per project, ready when you are.</h2>
          <p>
            Not a sandboxed tab and not a shared container — a dedicated machine
            that behaves like the one under your desk, minus the setup.
          </p>
        </div>

        <div className="mk-rows">
          <article className="mk-row">
            <div>
              <span className="mk-card-num">A space of its own</span>
              <h3>Your project, walled off from everything else.</h3>
              <p>
                Each project gets its own virtual machine with its own
                filesystem and network boundary. A runaway script or a risky
                command in one project can&rsquo;t reach another, and nobody
                else shares your space. It&rsquo;s yours until you delete it.
              </p>
              <ul className="mk-checks">
                <li>One isolated VM per project</li>
                <li>Private filesystem and network</li>
                <li>Your code is never used to train models</li>
              </ul>
            </div>
            <div className="mk-row-art" aria-hidden="true">
              <svg width="180" height="150" viewBox="0 0 180 150" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" style={{ color: "var(--mk-muted)" }}>
                <rect x="20" y="22" width="140" height="92" rx="8" />
                <path d="M20 40h140" />
                <circle cx="32" cy="31" r="2.4" fill="currentColor" stroke="none" />
                <circle cx="42" cy="31" r="2.4" fill="currentColor" stroke="none" />
                <circle cx="52" cy="31" r="2.4" fill="currentColor" stroke="none" />
                <rect x="36" y="56" width="108" height="44" rx="6" stroke="var(--brand-magenta)" />
                <path d="M58 78l8 8M122 78l-8 8M80 92l20-28" stroke="var(--brand-magenta)" />
                <path d="M64 124h52M78 124v8M102 124v8" />
              </svg>
            </div>
          </article>

          <article className="mk-row flip">
            <div>
              <span className="mk-card-num">A real computer, not a toy</span>
              <h3>Install software. Run a database. Start your app.</h3>
              <p>
                This is a full Linux machine, so the agent can do what a
                developer does: install packages, run a real Postgres or Redis,
                spin up background jobs, and boot your dev server on
                0.0.0.0 so the preview can reach it. No &ldquo;that command
                isn&rsquo;t supported here&rdquo; surprises.
              </p>
              <ul className="mk-checks">
                <li>Real package installs and build tools</li>
                <li>Run databases and background services</li>
                <li>Start long-running servers and watch the logs</li>
              </ul>
            </div>
            <div className="mk-row-art" aria-hidden="true">
              <svg width="180" height="150" viewBox="0 0 180 150" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mk-muted)" }}>
                <rect x="20" y="20" width="140" height="64" rx="8" stroke="var(--mk-cyan)" />
                <path d="M34 38l10 10-10 10M58 60h22" stroke="var(--mk-cyan)" />
                <ellipse cx="90" cy="104" rx="38" ry="11" />
                <path d="M52 104v22c0 6 17 11 38 11s38-5 38-11v-22" />
                <path d="M52 115c0 6 17 11 38 11s38-5 38-11" />
              </svg>
            </div>
          </article>

          <article className="mk-row">
            <div>
              <span className="mk-card-num">See it live</span>
              <h3>Your app, running, right next to the code.</h3>
              <p>
                A live preview sits beside the workspace and updates as the app
                changes — so you watch it come together instead of guessing.
                Ask the agent to try a flow and it can drive the preview
                itself — clicking, filling in forms, navigating between pages —
                then report back console errors and layout glitches it caught
                along the way, narrating each step live as it goes.
              </p>
              <ul className="mk-checks">
                <li>Live preview alongside your code</li>
                <li>The agent can click through and test your app itself</li>
                <li>Point at the preview to leave a note on the UI</li>
              </ul>
            </div>
            <div className="mk-row-art" aria-hidden="true">
              <svg width="186" height="150" viewBox="0 0 186 150" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" style={{ color: "var(--mk-muted)" }}>
                <rect x="14" y="26" width="74" height="98" rx="8" />
                <path d="M22 44h58M22 56h44M22 68h52M22 80h36" stroke="var(--brand-purple)" strokeLinecap="round" />
                <rect x="98" y="26" width="74" height="98" rx="8" stroke="var(--brand-magenta)" />
                <path d="M98 44h74" stroke="var(--brand-magenta)" />
                <rect x="110" y="58" width="50" height="30" rx="4" stroke="var(--brand-magenta)" />
                <path d="M110 102h50M110 112h32" stroke="var(--brand-magenta)" strokeLinecap="round" />
              </svg>
            </div>
          </article>

          <article className="mk-row flip">
            <div>
              <span className="mk-card-num">Pick up where you left off</span>
              <h3>Close the tab. Come back. Nothing&rsquo;s gone.</h3>
              <p>
                Workspaces pause when you step away and resume in seconds —
                exactly as you left them. Your files, your running services, and
                your chat history are saved with your account, so you can
                continue across sessions and devices without re-explaining the
                project.
              </p>
              <ul className="mk-checks">
                <li>Reopen a warm project in well under a second</li>
                <li>Files and chat history saved to your account</li>
                <li>Same state, on any device you sign in from</li>
              </ul>
            </div>
            <div className="mk-row-art" aria-hidden="true">
              <svg width="170" height="150" viewBox="0 0 170 150" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mk-muted)" }}>
                <path d="M30 75a55 55 0 1 0 18-41" stroke="var(--mk-green)" />
                <path d="M30 38v22h22" stroke="var(--mk-green)" />
                <path d="M85 50v25l18 11" />
              </svg>
            </div>
          </article>

          <article className="mk-row">
            <div>
              <span className="mk-card-num">Experiment safely</span>
              <h3>Try the bold idea. Rewind if it doesn&rsquo;t land.</h3>
              <p>
                Projects save restore points as you work. If an experiment goes
                sideways — a refactor that breaks the build, a dependency that
                fights back — roll the workspace to an earlier checkpoint
                without losing the rest of your progress. The freedom to try
                things is the whole point.
              </p>
              <ul className="mk-checks">
                <li>Automatic checkpoints as you build</li>
                <li>Rewind the workspace to a known-good state</li>
                <li>Guardrails flag risky moves before they run</li>
              </ul>
            </div>
            <div className="mk-row-art" aria-hidden="true">
              <svg width="180" height="150" viewBox="0 0 180 150" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mk-muted)" }}>
                <path d="M30 75h120" />
                <circle cx="42" cy="75" r="7" fill="currentColor" stroke="none" />
                <circle cx="84" cy="75" r="7" stroke="var(--mk-amber)" />
                <circle cx="126" cy="75" r="7" fill="currentColor" stroke="none" />
                <path d="M84 68V42M73 53l11-11 11 11" stroke="var(--mk-amber)" />
                <path d="M126 82v26M115 97l11 11 11-11" />
              </svg>
            </div>
          </article>
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">What&rsquo;s inside a workspace</span>
          <h2>Everything the build needs, in one place.</h2>
          <p>
            Open a project and it&rsquo;s all there — the editor, the
            conversation, the running machine, and the controls to ship.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {INSIDE.map((item) => (
            <article className="mk-card hover" key={item.title}>
              <span className={`mk-ic ${item.iconClass}`}>
                <InsideIcon name={item.icon} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-prose">
          <h2>Why a whole machine?</h2>
          <p>
            Most AI tools run your code in a shared, stripped-down sandbox — fine
            for a snippet, frustrating for a real app. Uniqus Code gives every
            project a dedicated virtual machine instead, so the agent can build
            the way a developer would: install what it needs, run the real
            stack, and prove the result in a live preview.
          </p>
          <p>
            That isolation is also what keeps your work safe. Because each
            project is walled off with its own filesystem and network boundary,
            nothing you build can reach another project, and your code is never
            used to train models. You decide when it leaves the workspace — read
            more about that on our{" "}
            <Link href="/security">security page</Link>, and about choosing the
            AI that does the building — Claude, GLM, GPT, or Gemini — on{" "}
            <Link href="/models">AI models</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
