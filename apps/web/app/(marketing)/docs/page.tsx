import Link from "next/link";
import DocsToc, { type DocsTocEntry } from "@/components/DocsToc";

export const metadata = {
  title: "Documentation - Gate 15",
  description:
    "Learn how to build, inspect, run, and ship real apps with Gate 15 — creating projects, working with the agent, previewing, prompting well, and troubleshooting.",
};

/**
 * Product documentation. Lives inside the `(marketing)` route group so it
 * inherits the shared chrome — `MarketingNav` and the `SiteFooter` + "Ready to
 * build?" composer — and, crucially, the marketing DESIGN LANGUAGE: it is built
 * from the same primitives as every other public page (`mk-hero`, `mk-card`,
 * `mk-grid`, `label-eyebrow`, the gradient accent word) rather than the app's
 * Settings `.doc-*` styles it used before, which made it read as a different
 * product. The only docs-specific layer is the sticky table-of-contents rail
 * (an asymmetric split) and a few editorial blocks (`.docs-*` in globals.css).
 *
 * The URL is `/docs` (route groups don't affect it). NOTE: `/docs` must stay in
 * the marketing layout's public paths or `withAuth()` bounces visitors to
 * sign-in before they can read it.
 */

const TOC: DocsTocEntry[] = [
  { href: "#overview", label: "Overview", n: "00" },
  { href: "#create", label: "Create or import", n: "01" },
  { href: "#workspace", label: "The workspace", n: "02" },
  { href: "#chat", label: "Work with the agent", n: "03" },
  { href: "#run", label: "Run & preview", n: "04" },
  { href: "#files", label: "Files, editor, logs", n: "05" },
  { href: "#configure", label: "Configure", n: "06" },
  { href: "#ship", label: "Ship", n: "07" },
  { href: "#recover", label: "Recover safely", n: "08" },
  { href: "#prompting", label: "Prompting", n: "09" },
  { href: "#troubleshoot", label: "Troubleshooting", n: "10" },
];

const LOOP = [
  "Describe the goal",
  "Review the plan",
  "Let Gate 15 edit files",
  "Run and preview",
  "Ask for the next change",
];

const QUICK_PATHS = [
  {
    label: "Start from an idea",
    title: "Describe it",
    body: "Write the project in plain English. Gate 15 names it, sharpens the first prompt, opens the workspace, and starts new projects with a plan you can review.",
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
    bestFor: "Best for a new app, website, tool, automation, or prototype.",
    detail:
      "Write the project in plain English. Gate 15 names it in about 200ms and the workspace opens with your brief forwarded to the agent verbatim — new projects start with a plan first. The fastest path when you can describe the shape.",
  },
  {
    title: "Upload .zip",
    bestFor: "Best for existing source code on your machine.",
    detail:
      "Imports archives up to 250 MB compressed. The importer skips .git/, node_modules/, and build output (.next/, dist/, build/) so the sandbox starts clean.",
  },
  {
    title: "Clone GitHub",
    bestFor: "Best for repos you want to edit, run, and optionally push back.",
    detail:
      "Connect GitHub to pick from your repos, or paste a URL and personal access token for private one-off imports. Guest accounts need to sign in before using GitHub.",
  },
] as const;

const DASHBOARD_TOOLS = [
  {
    title: "Templates",
    body: "Start a new project from a working example instead of a blank page.",
  },
  {
    title: "Databases",
    body: "Connect a Supabase project in a couple of clicks — Gate 15 provisions the database and stores the keys — then browse tables, preview data, and run SQL without leaving the dashboard.",
  },
  {
    title: "Design Systems",
    body: "Generate a full design-token set — colors, type, components — from a brief, an existing project, a live URL, a Figma file, or an upload, with a live preview styled in your own tokens.",
  },
  {
    title: "Skills library",
    body: "Save reusable skills at the account level — curated starter packs or your own — and mark any to auto-apply to every new project. Separate from a project's own Skills doc under Configure.",
  },
  {
    title: "Knowledge",
    body: "Attach PDFs, spreadsheets, and Word docs as reference material the agent can read across your projects.",
  },
  {
    title: "Teams",
    body: "Invite teammates to a project as owner, admin, editor, or viewer, leave comments, and share an organization workspace.",
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
  ["Plan", "Ask Gate 15 to inspect the project with read-only tools and propose editable steps before it changes files — you watch it investigate in real time. New projects start this way by default."],
  ["Ask before edits", "Pause for your approval before each edit, command, or risky operation."],
  ["Auto-accept edits", "Edits and routine commands run right away; the agent still pauses for anything dangerous or expensive."],
  ["Full autonomy", "Run everything without asking, with no safety prompts. Switch between any of the four modes at any time, even mid-turn, from the composer."],
  ["Files", "Attach images, PDFs, CSVs, design references, or other files the agent should use as evidence."],
  ["@ file", "Reference exact project files so the agent reads the right code before editing."],
  ["/ commands", "Run built-in or project slash commands from the composer."],
  ["Model", "Stay on Auto — which routes each step to whichever configured model fits best — or pin Claude, GLM, GPT, or Gemini for this turn and dial thinking effort from low to max."],
  ["Stop", "Cancel the current turn. Work already written to disk is kept, so you can redirect from there."],
];

const RUN_STEPS: ReadonlyArray<readonly [string, string]> = [
  ["Start the server.", "Run stops any existing project server, starts the app again, and streams the command result into chat and Logs."],
  ["Inspect the preview.", "Use preview tabs to check the live app. Markdown files can also switch between source and rendered preview in the editor."],
  ["Ask for verification.", "For UI work, ask Gate 15 to verify desktop and mobile states and drive the real flow. For backend work, ask it to run focused tests or exercise the relevant endpoint."],
];

const CONFIG_ITEMS = [
  {
    title: "Skills",
    body: "Project instructions prepended to the agent's system prompt. Use them for conventions, design rules, preferred libraries, testing habits, and project-specific constraints.",
  },
  {
    title: "Secrets",
    body: "Encrypted API keys and tokens stay outside the coding sandbox and model context. Trusted connectors and deployment backends resolve them server-side.",
  },
  {
    title: "Default model",
    body: "Set Auto or choose a specific provider/model in Settings — Anthropic, Z.ai, OpenAI, or Google. You can also override the model and thinking effort per turn from the chat composer.",
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

const RECOVER = [
  { title: "Stop", body: "Interrupt the active turn and redirect from the current files." },
  { title: "Rewind", body: "Browse checkpoints and restore an earlier project state when a direction goes sideways." },
  { title: "Synced status", body: "Use the status bar to see whether files have been saved recently before you act." },
] as const;

// Prompting principles excerpted and reworded for users from the agent's system
// prompt (services/orchestrator/src/agent/loop.ts, buildSystemPrompt). Only the
// user-relevant parts — not the whole prompt.
const PROMPTING_PRINCIPLES = [
  {
    title: "The agent verifies UI by interacting with it",
    body: "After meaningful frontend work, Gate 15 starts a preview and drives it — clicking through real flows, filling forms, submitting, navigating — then checks desktop and mobile, console errors, and accessibility before reporting done. You can ask for this explicitly: “run the signup flow and confirm it lands on the dashboard.” You'll watch each step live in a Preview (Agent) tab.",
  },
  {
    title: "Secrets stay server-side",
    body: "Add API keys and tokens in the Secrets pane. They remain encrypted outside the coding sandbox and resolve only inside trusted connectors or the deployment backend. Don't paste live credentials into a normal message.",
  },
  {
    title: "Let Gate 15 run things for you",
    body: "You don't have a terminal in the sandbox, and the agent knows that — it won't tell you to run npm run dev, installs, builds, or deploys yourself. If a command is needed, it runs with the agent's tools and the output streams into Logs. When a web app is ready, the agent shares the real public preview URL, never a localhost link.",
  },
  {
    title: "Dev servers bind to 0.0.0.0, not localhost",
    body: "The preview reaches your dev server across a network boundary, so a server bound to 127.0.0.1 shows up as a blank 502. The agent binds to 0.0.0.0 for you. If you bring your own start script, make sure it passes the framework's host flag (next dev -H 0.0.0.0, vite --host 0.0.0.0, flask run --host=0.0.0.0, and so on).",
  },
  {
    title: "Ask for current facts when they matter",
    body: "Training data lags reality by months, especially for AI model names, library versions, and prices. When your task depends on the current lineup — a model picker, a “compare the latest” page, a freshly released API — say so. The agent can web-search to confirm before it writes code instead of trusting a stale memory.",
  },
] as const;

const PROMPT_PARTS: ReadonlyArray<readonly [string, string]> = [
  ["Goal", "Say who it is for and what success looks like."],
  ["Context", "Name the stack, files, data shape, screenshots, constraints, and examples."],
  ["Scope", "Ask for one coherent slice, then iterate after you see it."],
  ["Proof", "Ask for tests, preview checks, screenshots, or command output."],
];

const BETTER_PROMPT =
  "Build a billing dashboard for a small SaaS founder so they can spot failed payments quickly. Use Next.js and the existing design tokens. Start with the overview screen, seed realistic mock data, run the app, and verify desktop and mobile layouts.";
const WEAK_PROMPT = "Make me a dashboard.";
const PROMPT_TEMPLATE =
  "Build [what] for [who] so they can [goal]. Use [stack or constraints]. Start with [first screen or workflow]. Use [attached files or @file references] as source material. Run [tests or preview] and tell me what you verified.";

const TROUBLESHOOTING = [
  {
    title: "Preview shows a 502 with an empty log",
    body: "Almost always a dev server bound to localhost instead of 0.0.0.0 — the preview proxy can't reach it across the sandbox boundary. The agent binds correctly by default; if you supplied a custom command, tell Gate 15 the preview is 502 and to rebind the server to 0.0.0.0 and restart. An empty server log with a 502 is the tell.",
  },
  {
    title: "The preview won't start at all",
    body: "Open Logs and ask Gate 15 to read the failing command output, fix the root cause, and rerun the app. Common culprits are a wrong port, a project in a subdirectory, or a syntax error surfaced in the log. Paste the exact error if you see one.",
  },
  {
    title: "Dependencies look corrupted or modules disappear",
    body: "This is a dependency-install race — two installs running in the same folder at once. Let the agent handle installs; it reconciles package.json and the lockfile at the sandbox root or the subdirectory being started. If you see missing-module errors after a manual install, ask Gate 15 to reinstall cleanly and restart the server.",
  },
  {
    title: "A long chat slows down or loses the thread",
    body: "Long sessions hit the model's context limit and get compacted (summarized) automatically, which can blur older detail. For a clean break, start a new chat session — it shares the same files, skills, secrets, and sandbox but begins with a fresh thread. Re-state the key facts the agent needs at the top.",
  },
  {
    title: "The connection drops or the workspace looks stale",
    body: "Gate 15 reconnects on its own; the status bar shows connection state and how recently files synced. If a turn looks stuck after a reconnect, refresh the workspace — your sandbox files and chat history are persisted, so nothing is lost. Then ask the agent to confirm the current state with git status or by re-reading the file.",
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
    body: "Attach screenshots, name the target screen size, and ask Gate 15 to verify with the preview. Concrete, specific visual feedback lands far better than asking it to make it nicer.",
  },
] as const;

export default function DocsPage() {
  return (
    <>
      <section className="mk-hero" id="overview" aria-labelledby="docs-title">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Documentation
          </span>
          <h1 id="docs-title">
            Build, inspect, run, and ship from{" "}
            <span className="grad">one workspace</span>.
          </h1>
          <p className="mk-lede">
            Gate 15 is an AI engineering workbench. You describe the outcome; the
            agent edits real files in an isolated sandbox, runs commands, starts
            previews, and reports back in chat. This guide walks the loop end to end —
            from a first prompt to a deployed app.
          </p>
          <div className="mk-hero-cta">
            <a href="#create" className="btn-primary btn-lg">
              Start the quickstart
            </a>
            <Link href="/templates" className="btn-secondary btn-lg">
              Browse templates
            </Link>
          </div>
          <div className="docs-loop" aria-label="The typical build loop">
            {LOOP.map((label, i) => (
              <span className="step" key={label}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Three ways in</span>
          <h2>Start from an idea, or bring your code.</h2>
          <p>
            However you begin, projects reopen with their sandbox, chat sessions,
            previews, skills, secrets, and checkpoints intact.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {QUICK_PATHS.map((item) => (
            <article className="mk-card hover" key={item.title}>
              <span className="mk-card-num">{item.label}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="mk-docs">
        <DocsToc entries={TOC} />

        <div className="mk-docs-body">
          {/* 01 — Create */}
          <section className="docs-sec" id="create" aria-labelledby="create-title">
            <div className="docs-sec-head">
              <span className="docs-index">01 · Create</span>
              <h2 id="create-title">Create or import a project</h2>
              <p>
                The new-project card on the dashboard has three tabs. Pick the one that
                matches how much source material you already have.
              </p>
            </div>
            <div className="docs-stack">
              <div className="mk-grid cols-3">
                {PROJECT_MODES.map((mode) => (
                  <article className="mk-card" key={mode.title}>
                    <h3>{mode.title}</h3>
                    <p className="docs-lead">{mode.bestFor}</p>
                    <p>{mode.detail}</p>
                  </article>
                ))}
              </div>
              <div className="docs-callout">
                <strong>Describe vs. import:</strong> <em>Describe your idea</em> is the
                fastest start for something new — Gate 15 names it and forwards your brief
                straight to the agent. Use <em>Upload .zip</em> or <em>Clone GitHub</em>{" "}
                when you already have code to edit, run, and (for GitHub) push back.
              </div>
              <div className="docs-subhead">
                <h3>Your dashboard has more than projects</h3>
                <p>
                  Alongside your project list, the sidebar has account-wide tools you&rsquo;ll
                  use across every project.
                </p>
              </div>
              <div className="mk-grid cols-3">
                {DASHBOARD_TOOLS.map((item) => (
                  <article className="mk-card" key={item.title}>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* 02 — Workspace */}
          <section className="docs-sec" id="workspace" aria-labelledby="workspace-title">
            <div className="docs-sec-head">
              <span className="docs-index">02 · Workspace</span>
              <h2 id="workspace-title">Know the workspace</h2>
              <p>
                The workspace is split like a lightweight IDE: conversation on the left,
                project files beside it, and the editor, preview, and logs on the right.
              </p>
            </div>
            <div className="mk-grid cols-3">
              {WORKSPACE_AREAS.map((area) => (
                <article className="mk-card" key={area.title}>
                  <h3>{area.title}</h3>
                  <p>{area.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* 03 — Agent */}
          <section className="docs-sec" id="chat" aria-labelledby="chat-title">
            <div className="docs-sec-head">
              <span className="docs-index">03 · Agent</span>
              <h2 id="chat-title">Work with the agent</h2>
              <p>
                Chat is where intent becomes code. The best turns tell Gate 15 what outcome
                matters, what evidence to inspect, and how to verify the result.
              </p>
            </div>
            <div className="docs-stack">
              <div className="docs-kv">
                {AGENT_CONTROLS.map(([label, body]) => (
                  <div className="docs-kv-row" key={label}>
                    <code>{label}</code>
                    <span>{body}</span>
                  </div>
                ))}
              </div>
              <div className="mk-grid cols-2">
                <article className="mk-card">
                  <h3>Chat sessions</h3>
                  <p>
                    Use the session dropdown to create a separate thread for a new
                    investigation. Sessions keep their own conversation history while
                    sharing the same project files and configuration.
                  </p>
                </article>
                <article className="mk-card">
                  <h3>Clearing chat</h3>
                  <p>
                    Clear removes the conversation history for that session. It does not
                    delete sandbox files, so the code remains available.
                  </p>
                </article>
                <article className="mk-card">
                  <h3>Sub-agents &amp; Activity</h3>
                  <p>
                    For multi-part builds, Gate 15 can spawn sub-agents that work
                    concurrently on different pieces. The Activity tab shows live
                    token/cost stats, sub-agent progress, and your task list as a turn
                    runs.
                  </p>
                </article>
                <article className="mk-card">
                  <h3>Generate images</h3>
                  <p>
                    Ask for an image and Gate 15 generates or edits one directly, then
                    uses the result immediately in your project.
                  </p>
                </article>
              </div>
            </div>
          </section>

          {/* 04 — Run */}
          <section className="docs-sec" id="run" aria-labelledby="run-title">
            <div className="docs-sec-head">
              <span className="docs-index">04 · Run</span>
              <h2 id="run-title">Run, preview, and verify</h2>
              <p>
                Click <strong>Run</strong> to start or restart the project dev server. The
                first run installs dependencies when needed, then opens a preview tab.
              </p>
            </div>
            <ol className="docs-steps">
              {RUN_STEPS.map(([strong, body]) => (
                <li key={strong}>
                  <strong>{strong}</strong>
                  <span>{body}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* 05 — Files */}
          <section className="docs-sec" id="files" aria-labelledby="files-title">
            <div className="docs-sec-head">
              <span className="docs-index">05 · Files</span>
              <h2 id="files-title">Use files, editor, and logs</h2>
              <p>
                You and the agent share the same sandbox. Direct edits, agent edits, file
                opens, and command output all stay in sync.
              </p>
            </div>
            <div className="mk-grid cols-2">
              <article className="mk-card">
                <h3>When to edit yourself</h3>
                <p>
                  Use the editor for tiny text tweaks, quick copy changes, or inspecting a
                  file while the agent works. Save is automatic through the workspace sync.
                </p>
              </article>
              <article className="mk-card">
                <h3>When to point the agent</h3>
                <p>
                  Use <code>@</code>-mentions when you want Gate 15 to follow an existing
                  pattern, patch a specific file, or explain why a piece of code behaves a
                  certain way.
                </p>
              </article>
            </div>
          </section>

          {/* 06 — Configure */}
          <section className="docs-sec" id="configure" aria-labelledby="configure-title">
            <div className="docs-sec-head">
              <span className="docs-index">06 · Configure</span>
              <h2 id="configure-title">Configure how Gate 15 works</h2>
              <p>
                Some settings belong to a project, and others apply account-wide. Use
                project tools for instructions and secrets; use Settings for defaults and
                appearance.
              </p>
            </div>
            <div className="docs-stack">
              <div className="mk-grid cols-2">
                {CONFIG_ITEMS.map((item) => (
                  <article className="mk-card" key={item.title}>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
              <Link href="/settings" className="docs-inline-link">
                Open Settings →
              </Link>
            </div>
          </section>

          {/* 07 — Ship */}
          <section className="docs-sec" id="ship" aria-labelledby="ship-title">
            <div className="docs-sec-head">
              <span className="docs-index">07 · Ship</span>
              <h2 id="ship-title">Ship with GitHub and deploys</h2>
              <p>
                Signed-in accounts can connect GitHub, create private repos from workspace
                projects, and deploy apps to Vercel from the topbar.
              </p>
            </div>
            <div className="docs-stack">
              <div className="mk-grid cols-3">
                <article className="mk-card">
                  <h3>Create a GitHub repo</h3>
                  <p>
                    Use <strong>Create GitHub repo</strong> in the workspace topbar to
                    create a fresh private repo and push the initial project state.
                  </p>
                </article>
                <article className="mk-card">
                  <h3>Deploy</h3>
                  <p>
                    Use <strong>Deploy</strong> to publish through Vercel. Set any
                    environment variables in the deploy modal, then watch status and history
                    in the same flow.
                  </p>
                </article>
                <article className="mk-card">
                  <h3>Take it with you</h3>
                  <p>
                    Download the whole project as a zip, drop your live app into any
                    page with an embed snippet, or share a preview link that expires
                    and can be revoked — no sign-in required for the person viewing it.
                  </p>
                </article>
              </div>
              <div className="docs-callout neutral">
                Guest work is saved on this device. Sign in to keep it permanently
                across devices and to unlock GitHub and publishing.
              </div>
            </div>
          </section>

          {/* 08 — Recover */}
          <section className="docs-sec" id="recover" aria-labelledby="recover-title">
            <div className="docs-sec-head">
              <span className="docs-index">08 · Recover</span>
              <h2 id="recover-title">Recover safely</h2>
              <p>
                The workspace is built for iteration. You can stop an agent turn, start a
                cleaner chat, or restore a checkpoint when a direction goes sideways.
              </p>
            </div>
            <div className="mk-grid cols-3">
              {RECOVER.map((item) => (
                <article className="mk-card" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* 09 — Prompting */}
          <section className="docs-sec" id="prompting" aria-labelledby="prompting-title">
            <div className="docs-sec-head">
              <span className="docs-index">09 · Prompting</span>
              <h2 id="prompting-title">Prompt the agent well</h2>
              <p>
                Strong prompts are specific enough to act on and small enough to verify.
                Treat each turn like a useful ticket for a careful engineer — and know how
                the agent already works so you can lean on it.
              </p>
            </div>
            <div className="docs-stack">
              <div className="mk-grid cols-2">
                <article className="mk-card is-good">
                  <span className="mk-card-num">Better first prompt</span>
                  <p className="docs-quote">{BETTER_PROMPT}</p>
                </article>
                <article className="mk-card">
                  <span className="mk-card-num">Less useful</span>
                  <p className="docs-quote">{WEAK_PROMPT}</p>
                </article>
              </div>

              <div className="docs-kv">
                {PROMPT_PARTS.map(([label, body]) => (
                  <div className="docs-kv-row" key={label}>
                    <code>{label}</code>
                    <span>{body}</span>
                  </div>
                ))}
              </div>

              <div className="docs-template">
                <span className="label-eyebrow">Copyable template</span>
                <p>{PROMPT_TEMPLATE}</p>
              </div>

              <div className="docs-subhead">
                <h3>How the agent works — so you can prompt for it</h3>
                <p>
                  These are the working principles the Gate 15 agent already follows.
                  Knowing them tells you what to ask for and what you can trust it to do on
                  its own.
                </p>
              </div>
              <div className="mk-grid cols-2">
                {PROMPTING_PRINCIPLES.map((p) => (
                  <article className="mk-card" key={p.title}>
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* 10 — Troubleshooting */}
          <section className="docs-sec" id="troubleshoot" aria-labelledby="troubleshoot-title">
            <div className="docs-sec-head">
              <span className="docs-index">10 · Troubleshooting</span>
              <h2 id="troubleshoot-title">Troubleshooting</h2>
              <p>
                Most problems get easier when you hand the agent the exact symptom and the
                evidence. These are the gotchas that come up most.
              </p>
            </div>
            <div className="docs-stack">
              <div className="mk-grid cols-2">
                {TROUBLESHOOTING.map((item) => (
                  <article className="mk-card" key={item.title}>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
              <div className="docs-callout neutral">
                Still stuck? Head to <Link href="/support">Support</Link> or ask in the{" "}
                <Link href="/community">community</Link>.
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
