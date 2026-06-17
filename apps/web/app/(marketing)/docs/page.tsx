import Link from "next/link";

export const metadata = {
  title: "Documentation - Uniqus Code",
  description:
    "Learn how to build, inspect, run, and ship real apps with Uniqus Code — creating projects, working with the agent, previewing, prompting well, and troubleshooting.",
};

/**
 * Product documentation. Lives inside the `(marketing)` route group so it
 * inherits the shared chrome — `MarketingNav` (which links back to the landing
 * page and every marketing/resource page) and the `SiteFooter` + "Ready to
 * build?" composer. That's deliberate: a visitor who opens the docs from the
 * marketing site must be able to get back without hitting a sign-in wall, and
 * the page should read as the same product. The URL is `/docs` (route groups
 * don't affect it). NOTE: `/docs` must be present in PUBLIC_PATHS in
 * apps/web/middleware.ts or the `(marketing)` layout's withAuth() bounces
 * visitors to sign-in.
 *
 * The page renders the docs body using the shared `.doc-*` styles (the same
 * ones Settings uses) so the type and surfaces match the app rather than
 * inventing a parallel look.
 */

type TocEntry = { href: string; label: string; index: string };

const TOC: TocEntry[] = [
  { href: "#overview", label: "Overview", index: "" },
  { href: "#create", label: "Create a project", index: "01" },
  { href: "#workspace", label: "The workspace", index: "02" },
  { href: "#chat", label: "Work with the agent", index: "03" },
  { href: "#run", label: "Run and preview", index: "04" },
  { href: "#files", label: "Files, editor, logs", index: "05" },
  { href: "#configure", label: "Configure", index: "06" },
  { href: "#ship", label: "Ship", index: "07" },
  { href: "#recover", label: "Recover safely", index: "08" },
  { href: "#prompting", label: "Prompting", index: "09" },
  { href: "#troubleshoot", label: "Troubleshooting", index: "10" },
];

const QUICK_PATHS = [
  {
    label: "Start from an idea",
    title: "Describe it",
    body: "Write the project in plain English. Uniqus names it, sharpens the first prompt, opens the workspace, and starts new projects with a plan you can review.",
  },
  {
    label: "Bring code with you",
    title: "Upload or clone",
    body: "Upload a .zip, clone from GitHub, or paste a repo URL with a token for a one-off import. Imported projects keep their file tree and chat history.",
  },
  {
    label: "Keep moving",
    title: "Reopen a project",
    body: "Projects reopen with their sandbox files, chat sessions, previews, skills, secrets, and checkpoints still attached.",
  },
] as const;

const PROJECT_MODES = [
  {
    title: "Describe your idea",
    bestFor: "A new app, website, tool, automation, or prototype.",
    detail:
      "Write the project in plain English. Uniqus names it in about 200ms and the workspace opens with your brief forwarded to the agent verbatim — new projects start with a plan first. The fastest path when you can describe the shape.",
  },
  {
    title: "Upload .zip",
    bestFor: "Existing source code on your machine.",
    detail:
      "Imports archives up to 250 MB compressed. The importer skips .git/, node_modules/, and build output (.next/, dist/, build/) so the sandbox starts clean.",
  },
  {
    title: "Clone GitHub",
    bestFor: "Repos you want to edit, run, and optionally push back.",
    detail:
      "Connect GitHub to pick from your repos, or paste a URL and personal access token for private one-off imports. Guest accounts need to sign in before using GitHub.",
  },
] as const;

const WORKSPACE_AREAS = [
  {
    title: "Chat",
    body: "Give instructions, review plans, attach references, switch chat sessions, pick a model, and stop an in-flight turn.",
  },
  {
    title: "Files",
    body: "Browse the sandbox tree, open files, edit directly, and reference files in chat with @-mentions.",
  },
  {
    title: "Editor & preview",
    body: "Inspect code, preview Markdown, and view running apps in the preview tabs created by Run or the agent.",
  },
  {
    title: "Logs",
    body: "Watch command output from installs, builds, tests, and dev servers without leaving the workspace.",
  },
  {
    title: "Topbar tools",
    body: "Run the app, deploy, create a GitHub repo, edit Skills, manage Secrets, rewind checkpoints, and toggle panels.",
  },
  {
    title: "Status bar",
    body: "Check connection state, active project, sync freshness, branch label, and encoding at a glance.",
  },
] as const;

const AGENT_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ["Plan", "Ask Uniqus to inspect the project with read-only tools and propose editable steps before it changes files — you watch it investigate in real time. New projects start this way by default."],
  ["Execute", "Let the agent act immediately for small, clear changes."],
  ["Files", "Attach images, PDFs, CSVs, design references, or other files the agent should use as evidence."],
  ["@ file", "Reference exact project files so the agent reads the right code before editing."],
  ["/ commands", "Run built-in or project slash commands from the composer."],
  ["Model", "Stay on Auto, or pick Claude, GPT, or Gemini for this turn and dial thinking effort from low to high."],
  ["Stop", "Cancel the current turn. Work already written to disk is kept, so you can redirect from there."],
];

const CONFIG_ITEMS = [
  {
    title: "Skills",
    body: "Project instructions prepended to the agent's system prompt. Use them for conventions, design rules, preferred libraries, testing habits, and project-specific constraints.",
  },
  {
    title: "Secrets",
    body: "Encrypted API keys and tokens. Panel-set secrets are written straight to .env in the sandbox; the agent can use them, but raw secret values are never printed back into chat.",
  },
  {
    title: "Default model",
    body: "Set Auto or choose a specific provider/model in Settings — Anthropic, OpenAI, or Google. You can also override the model and thinking effort per turn from the chat composer.",
  },
  {
    title: "Custom prompts",
    body: "Account-wide instructions and default skills for new projects. Use this for preferences you want every fresh project to inherit.",
  },
  {
    title: "Appearance",
    body: "Switch dark/light theme and comfortable/compact density in Settings. Docs, dashboard, and workspace share the same tokens.",
  },
] as const;

// Prompting principles excerpted and reworded for users from the agent's
// system prompt (services/orchestrator/src/agent/loop.ts, buildSystemPrompt).
// Only the user-relevant parts — not the whole prompt.
const PROMPTING_PRINCIPLES = [
  {
    title: "The agent verifies UI by interacting with it",
    body: "After meaningful frontend work, Uniqus starts a preview and drives it — clicking through real flows, filling forms, submitting, navigating — then checks desktop and mobile, console errors, and accessibility before reporting done. You can ask for this explicitly: \"run the signup flow and confirm it lands on the dashboard.\" You'll watch each step live in a Preview (Agent) tab.",
  },
  {
    title: "Secrets stay server-side",
    body: "Add API keys and tokens in the Secrets pane — they're written to .env automatically and resolve server-side. The agent won't print secret values back into chat or bake a service-role key into client code, so don't paste live credentials into a normal message; use Secrets instead.",
  },
  {
    title: "Let Uniqus run things for you",
    body: "You don't have a terminal in the sandbox, and the agent knows that — it won't tell you to run npm run dev, installs, builds, or deploys yourself. If a command is needed, it runs with the agent's tools and the output streams into Logs. When a web app is ready, the agent shares the real public preview URL, never a localhost link.",
  },
  {
    title: "Dev servers bind to 0.0.0.0, not localhost",
    body: "The preview reaches your dev server across a network boundary, so a server bound to 127.0.0.1 shows up as a blank 502. The agent binds to 0.0.0.0 for you. If you bring your own start script or run command, make sure it passes the framework's host flag (next dev -H 0.0.0.0, vite --host 0.0.0.0, flask run --host=0.0.0.0, and so on).",
  },
  {
    title: "Ask for current facts when they matter",
    body: "Training data lags reality by months, especially for AI model names, library versions, and prices. When your task depends on the current lineup — a model picker, a \"compare the latest\" page, a freshly released API — say so. The agent can web-search to confirm before it writes code instead of trusting a stale memory.",
  },
] as const;

const PROMPT_PARTS: ReadonlyArray<readonly [string, string]> = [
  ["Goal", "Say who it is for and what success looks like."],
  ["Context", "Name the stack, files, data shape, screenshots, constraints, and examples."],
  ["Scope", "Ask for one coherent slice, then iterate after you see it."],
  ["Proof", "Ask for tests, preview checks, screenshots, or command output."],
];

const TROUBLESHOOTING = [
  {
    title: "Preview shows a 502 with an empty log",
    body: "Almost always a dev server bound to localhost instead of 0.0.0.0 — the preview proxy can't reach it across the sandbox boundary. The agent binds correctly by default; if you supplied a custom command, tell Uniqus \"the preview is 502, rebind the server to 0.0.0.0 and restart.\" An empty server log with a 502 is the tell.",
  },
  {
    title: "The preview won't start at all",
    body: "Open Logs and ask Uniqus to read the failing command output, fix the root cause, and rerun the app. Common culprits are a wrong port, a project in a subdirectory, or a syntax error surfaced in the log. Paste the exact error if you see one.",
  },
  {
    title: "Dependencies look corrupted or modules \"disappear\"",
    body: "This is a dependency-install race — two installs running in the same folder at once. Let the agent handle installs; it auto-installs at the sandbox root and won't run a second install on top. If you see missing-module errors after a manual install, ask Uniqus to reinstall cleanly and restart the server.",
  },
  {
    title: "A long chat slows down or loses the thread",
    body: "Long sessions hit the model's context limit and get compacted (summarized) automatically, which can blur older detail. For a clean break, start a new chat session — it shares the same files, skills, secrets, and sandbox but begins with a fresh thread. Re-state the key facts the agent needs at the top.",
  },
  {
    title: "The connection drops or the workspace looks stale",
    body: "Uniqus reconnects on its own; the status bar shows connection state and how recently files synced. If a turn looks stuck after a reconnect, refresh the workspace — your sandbox files and chat history are persisted, so nothing is lost. Then ask the agent to confirm the current state with git status or by re-reading the file.",
  },
  {
    title: "The agent changed the wrong thing",
    body: "Stop the turn, point at the specific file or UI area, and ask for a focused correction. Use Rewind to restore an earlier checkpoint when a direction goes sideways.",
  },
  {
    title: "A private repo won't import",
    body: "Connect GitHub from the dashboard or Settings, or paste a token with repo access. Guest accounts must sign in before GitHub features appear.",
  },
  {
    title: "The design is close but not right",
    body: "Attach screenshots, name the target screen size, and ask Uniqus to verify with the preview. Concrete, specific visual feedback lands far better than \"make it nicer.\"",
  },
] as const;

export default function DocsPage() {
  return (
    <div className="doc-shell doc-shell-wide">
      <aside className="doc-toc" aria-label="Documentation sections">
        <div className="label-micro">Docs</div>
        {TOC.map((entry) => (
          <a key={entry.href} href={entry.href}>
            {entry.label}
          </a>
        ))}
      </aside>

      <main className="doc doc-guide">
        <section id="overview" className="doc-hero" aria-labelledby="docs-title">
          <div>
            <p className="doc-kicker">Uniqus Code documentation</p>
            <h1 id="docs-title">Build, inspect, run, and ship from one workspace.</h1>
            <p className="doc-lede">
              Uniqus Code is an AI engineering workbench. You describe the outcome; the
              agent edits real files in an isolated sandbox, runs commands, starts
              previews, and reports back through chat. This guide walks the loop end to
              end — from a first prompt to a deployed app.
            </p>
          </div>
          <div className="doc-hero-panel" aria-label="Common workflow">
            <div className="label-micro">Typical loop</div>
            <ol className="doc-mini-steps">
              <li>Describe the goal</li>
              <li>Review the plan</li>
              <li>Let Uniqus edit files</li>
              <li>Run and preview</li>
              <li>Ask for the next change</li>
            </ol>
          </div>
        </section>

        <div className="doc-quick-grid" aria-label="Fast paths">
          {QUICK_PATHS.map((item) => (
            <article key={item.title} className="doc-card doc-card-accent">
              <div className="doc-card-label">{item.label}</div>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </div>

        <section id="create" className="doc-section" aria-labelledby="create-title">
          <div className="doc-section-head">
            <p className="doc-kicker">01</p>
            <h2 id="create-title">Create or import a project</h2>
            <p>
              The new-project card on the dashboard has three tabs. Pick the one that
              matches how much source material you already have.
            </p>
          </div>
          <div className="doc-grid two">
            {PROJECT_MODES.map((mode) => (
              <article key={mode.title} className="doc-card">
                <h3>{mode.title}</h3>
                <p className="doc-card-sub">{mode.bestFor}</p>
                <p>{mode.detail}</p>
              </article>
            ))}
          </div>
          <div className="doc-callout">
            <strong>Describe vs. import:</strong> <em>Describe your idea</em> is the
            fastest start for something new — Uniqus names it and forwards your brief
            straight to the agent. Use <em>Upload .zip</em> or <em>Clone GitHub</em> when
            you already have code to edit, run, and (for GitHub) push back.
          </div>
        </section>

        <section id="workspace" className="doc-section" aria-labelledby="workspace-title">
          <div className="doc-section-head">
            <p className="doc-kicker">02</p>
            <h2 id="workspace-title">Know the workspace</h2>
            <p>
              The workspace is split like a lightweight IDE: conversation on the left,
              project files beside it, and the editor, preview, and logs on the right.
            </p>
          </div>
          <div className="doc-grid three">
            {WORKSPACE_AREAS.map((area) => (
              <article key={area.title} className="doc-card compact">
                <h3>{area.title}</h3>
                <p>{area.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="chat" className="doc-section" aria-labelledby="chat-title">
          <div className="doc-section-head">
            <p className="doc-kicker">03</p>
            <h2 id="chat-title">Work with the agent</h2>
            <p>
              Chat is where intent becomes code. The best turns tell Uniqus what outcome
              matters, what evidence to inspect, and how to verify the result.
            </p>
          </div>
          <div className="doc-command-list">
            {AGENT_CONTROLS.map(([label, body]) => (
              <div key={label} className="doc-command-row">
                <code>{label}</code>
                <span>{body}</span>
              </div>
            ))}
          </div>
          <div className="doc-note-grid">
            <div className="doc-note">
              <h3>Chat sessions</h3>
              <p>
                Use the session dropdown to create a separate thread for a new
                investigation. Sessions keep their own conversation history while sharing
                the same project files and configuration.
              </p>
            </div>
            <div className="doc-note">
              <h3>Clearing chat</h3>
              <p>
                Clear removes the conversation history for that session. It does not
                delete sandbox files, so the code remains available.
              </p>
            </div>
          </div>
        </section>

        <section id="run" className="doc-section" aria-labelledby="run-title">
          <div className="doc-section-head">
            <p className="doc-kicker">04</p>
            <h2 id="run-title">Run, preview, and verify</h2>
            <p>
              Click <strong>Run</strong> to start or restart the project dev server. The
              first run installs dependencies when needed, then opens a preview tab.
            </p>
          </div>
          <ol className="doc-step-list">
            <li>
              <strong>Start the server.</strong>
              <span>
                Run stops any existing project server, starts the app again, and streams
                the command result into chat and Logs.
              </span>
            </li>
            <li>
              <strong>Inspect the preview.</strong>
              <span>
                Use preview tabs to check the live app. Markdown files can also switch
                between source and rendered preview in the editor.
              </span>
            </li>
            <li>
              <strong>Ask for verification.</strong>
              <span>
                For UI work, ask Uniqus to verify desktop and mobile states and drive the
                real flow. For backend work, ask it to run focused tests or exercise the
                relevant endpoint.
              </span>
            </li>
          </ol>
        </section>

        <section id="files" className="doc-section" aria-labelledby="files-title">
          <div className="doc-section-head">
            <p className="doc-kicker">05</p>
            <h2 id="files-title">Use files, editor, and logs</h2>
            <p>
              You and the agent share the same sandbox. Direct edits, agent edits, file
              opens, and command output all stay in sync.
            </p>
          </div>
          <div className="doc-grid two">
            <article className="doc-card">
              <h3>When to edit yourself</h3>
              <p>
                Use the editor for tiny text tweaks, quick copy changes, or inspecting a
                file while the agent works. Save is automatic through the workspace sync.
              </p>
            </article>
            <article className="doc-card">
              <h3>When to point the agent</h3>
              <p>
                Use <code>@</code>-mentions when you want Uniqus to follow an existing
                pattern, patch a specific file, or explain why a piece of code behaves a
                certain way.
              </p>
            </article>
          </div>
        </section>

        <section id="configure" className="doc-section" aria-labelledby="configure-title">
          <div className="doc-section-head">
            <p className="doc-kicker">06</p>
            <h2 id="configure-title">Configure how Uniqus works</h2>
            <p>
              Some settings belong to a project, and others apply account-wide. Use
              project tools for instructions and secrets; use Settings for defaults and
              appearance.
            </p>
          </div>
          <div className="doc-grid two">
            {CONFIG_ITEMS.map((item) => (
              <article key={item.title} className="doc-card">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <p className="doc-inline-action">
            <Link href="/settings">Open Settings</Link>
          </p>
        </section>

        <section id="ship" className="doc-section" aria-labelledby="ship-title">
          <div className="doc-section-head">
            <p className="doc-kicker">07</p>
            <h2 id="ship-title">Ship with GitHub and deploys</h2>
            <p>
              Signed-in accounts can connect GitHub, create private repos from workspace
              projects, and deploy apps to Vercel from the topbar.
            </p>
          </div>
          <div className="doc-grid two">
            <article className="doc-card">
              <h3>Create a GitHub repo</h3>
              <p>
                Use <strong>Create GitHub repo</strong> in the workspace topbar to create
                a fresh private repo and push the initial project state.
              </p>
            </article>
            <article className="doc-card">
              <h3>Deploy</h3>
              <p>
                Use <strong>Deploy</strong> to publish through Vercel. Set any environment
                variables in the deploy modal, then watch status and history in the same
                flow.
              </p>
            </article>
          </div>
          <div className="doc-callout neutral">
            Guest work is saved on this device. Sign in with Google to keep it permanently
            across devices and to unlock GitHub and publishing.
          </div>
        </section>

        <section id="recover" className="doc-section" aria-labelledby="recover-title">
          <div className="doc-section-head">
            <p className="doc-kicker">08</p>
            <h2 id="recover-title">Recover safely</h2>
            <p>
              The workspace is built for iteration. You can stop an agent turn, start a
              cleaner chat, or restore a checkpoint when a direction goes sideways.
            </p>
          </div>
          <div className="doc-safety-strip">
            <div>
              <strong>Stop</strong>
              <span>Interrupt the active turn and redirect from the current files.</span>
            </div>
            <div>
              <strong>Rewind</strong>
              <span>Browse checkpoints and restore an earlier project state.</span>
            </div>
            <div>
              <strong>Synced status</strong>
              <span>Use the status bar to see whether files have been saved recently.</span>
            </div>
          </div>
        </section>

        <section id="prompting" className="doc-section" aria-labelledby="prompting-title">
          <div className="doc-section-head">
            <p className="doc-kicker">09</p>
            <h2 id="prompting-title">Prompt the agent well</h2>
            <p>
              Strong prompts are specific enough to act on and small enough to verify.
              Treat each turn like a useful ticket for a careful engineer — and know how
              the agent already works so you can lean on it.
            </p>
          </div>

          <div className="doc-grid two">
            <article className="doc-example good">
              <div className="doc-card-label">Better first prompt</div>
              <p>
                Build a billing dashboard for a small SaaS founder so they can spot failed
                payments quickly. Use Next.js and the existing design tokens. Start with
                the overview screen, seed realistic mock data, run the app, and verify
                desktop and mobile layouts.
              </p>
            </article>
            <article className="doc-example">
              <div className="doc-card-label">Less useful</div>
              <p>Make me a dashboard.</p>
            </article>
          </div>

          <div className="doc-command-list">
            {PROMPT_PARTS.map(([label, body]) => (
              <div key={label} className="doc-command-row">
                <code>{label}</code>
                <span>{body}</span>
              </div>
            ))}
          </div>

          <div className="doc-template">
            <div className="label-micro">Copyable template</div>
            <p>
              Build [what] for [who] so they can [goal]. Use [stack or constraints]. Start
              with [first screen or workflow]. Use [attached files or @file references] as
              source material. Run [tests or preview] and tell me what you verified.
            </p>
          </div>

          <div className="doc-section-head">
            <h3>How the agent works — so you can prompt for it</h3>
            <p>
              These are the working principles the Uniqus agent already follows. Knowing
              them tells you what to ask for and what you can trust it to do on its own.
            </p>
          </div>
          <div className="doc-grid two">
            {PROMPTING_PRINCIPLES.map((p) => (
              <article key={p.title} className="doc-card">
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="troubleshoot" className="doc-section" aria-labelledby="troubleshoot-title">
          <div className="doc-section-head">
            <p className="doc-kicker">10</p>
            <h2 id="troubleshoot-title">Troubleshooting</h2>
            <p>
              Most problems get easier when you hand the agent the exact symptom and the
              evidence. These are the gotchas that come up most.
            </p>
          </div>
          <div className="doc-grid two">
            {TROUBLESHOOTING.map((item) => (
              <article key={item.title} className="doc-card compact">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <div className="doc-callout neutral">
            Still stuck? Head to <Link href="/support">Support</Link> or ask in the{" "}
            <Link href="/community">community</Link>.
          </div>
        </section>
      </main>
    </div>
  );
}
