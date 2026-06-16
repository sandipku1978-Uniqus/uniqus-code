import Link from "next/link";

export const metadata = {
  title: "User guide - Uniqus Code",
};

/**
 * The user guide lives inside the `(marketing)` route group so it inherits the
 * shared chrome — `MarketingNav` (which links back to the landing page and every
 * marketing/resource page) and the `SiteFooter` + "Ready to build?" composer.
 * That's deliberate: a visitor who opens the guide from the marketing site must
 * be able to get back without hitting a sign-in wall, and the page should read
 * as the same product. The URL stays `/guide` (route groups don't affect it).
 *
 * The page itself only renders the docs body into `.mk-main`; it uses the shared
 * `.doc-*` styles (the same ones Settings uses) so the type and surfaces match
 * the app rather than inventing a parallel look.
 */

const toc = [
  ["#start", "Start here"],
  ["#create", "Create projects"],
  ["#workspace", "Workspace tour"],
  ["#chat", "Work with the agent"],
  ["#run", "Run and preview"],
  ["#files", "Files and logs"],
  ["#configure", "Configure"],
  ["#ship", "Ship"],
  ["#recover", "Recover safely"],
  ["#prompting", "Prompting"],
  ["#troubleshoot", "Troubleshooting"],
] as const;

const quickPaths = [
  {
    label: "Start from an idea",
    title: "Describe in detail",
    body: "Write the project in plain English. Uniqus names it, sharpens the first prompt, opens the workspace, and begins with a plan for new projects.",
  },
  {
    label: "Bring code with you",
    title: "Upload or clone",
    body: "Upload a .zip, clone from GitHub, or paste a repo URL with a token for a one-off import. Imported projects keep their file tree and chat history.",
  },
  {
    label: "Keep moving",
    title: "Open an existing project",
    body: "Projects reopen with their sandbox files, chat sessions, previews, skills, secrets, and checkpoints still attached.",
  },
] as const;

const projectModes = [
  {
    title: "Describe your idea",
    bestFor: "A new app, website, tool, automation, or prototype.",
    detail:
      "Write the project in plain English. Haiku names it (~200ms) and the workspace opens with your brief forwarded to the agent verbatim — starting with a plan first for new projects. The fastest path when you can describe the shape.",
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

const workspaceAreas = [
  {
    title: "Chat",
    body: "Give instructions, review plans, attach references, switch chat sessions, pick a model, and stop an in-flight turn.",
  },
  {
    title: "Files",
    body: "Browse the sandbox tree, open files, edit directly, and reference files in chat with @-mentions.",
  },
  {
    title: "Editor and preview",
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

const agentControls = [
  ["Plan", "Ask Uniqus to inspect the project with read-only tools and propose editable steps before it changes files — you watch it investigate in real time. New projects start this way by default."],
  ["Execute", "Let the agent act immediately for small, clear changes."],
  ["Files", "Attach images, PDFs, CSVs, design references, or other files the agent should use as evidence."],
  ["@ file", "Reference exact project files so the agent reads the right code before editing."],
  ["/ commands", "Run built-in or project slash commands from the composer."],
  ["Model", "Stay on Auto, or pick Claude, GPT, or Gemini for this turn and dial thinking effort from low to high."],
  ["Stop", "Cancel the current turn. Work already written to disk is kept, so you can redirect from there."],
] as const;

const configItems = [
  {
    title: "Skills",
    body: "Project instructions that are prepended to the agent's system prompt. Use them for conventions, design rules, preferred libraries, testing habits, and project-specific constraints.",
  },
  {
    title: "Secrets",
    body: "Encrypted API keys and tokens. The agent can request values through controlled tooling, but the secret values are not printed back into chat.",
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
    body: "Switch dark/light theme and comfortable/compact density in Settings. The guide, dashboard, and workspace share the same tokens.",
  },
] as const;

const troubleshooting = [
  {
    title: "The preview does not start",
    body: "Open Logs and ask Uniqus to read the failing command output, fix the root cause, and rerun the app. Mention the exact error if you see one.",
  },
  {
    title: "The agent changed the wrong thing",
    body: "Stop the turn, point at the specific file or UI area, and ask for a focused correction. Use Rewind when you want to restore a checkpoint.",
  },
  {
    title: "A private repo will not import",
    body: "Connect GitHub from the dashboard or Settings, or paste a token with repo access. Guest accounts must sign in before GitHub features appear.",
  },
  {
    title: "The design is close but not right",
    body: "Attach screenshots, name the target screen size, and ask Uniqus to verify with the preview. Small visual feedback works best when it is concrete.",
  },
  {
    title: "A chat got too noisy",
    body: "Create a new chat session for a fresh thread. Sessions share the same project files, skills, secrets, and sandbox.",
  },
] as const;

export default function GuidePage() {
  return (
    <div className="doc-shell doc-shell-wide">
      <aside className="doc-toc" aria-label="Guide sections">
        <div className="label-micro">Guide</div>
        {toc.map(([href, label]) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
      </aside>

      <main className="doc doc-guide">
        <section id="start" className="doc-hero" aria-labelledby="guide-title">
          <div>
            <p className="doc-kicker">Uniqus Code user guide</p>
            <h1 id="guide-title">Build, inspect, run, and ship from one workspace.</h1>
            <p className="doc-lede">
              Uniqus Code is an AI engineering workbench. You describe the outcome, the
              agent edits real files in an isolated sandbox, runs commands, starts
              previews, and reports back through chat.
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
          {quickPaths.map((item) => (
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
            {projectModes.map((mode) => (
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
            {workspaceAreas.map((area) => (
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
              Chat is where intent becomes code. The best turns tell Uniqus what
              outcome matters, what evidence to inspect, and how to verify the result.
            </p>
          </div>
          <div className="doc-command-list">
            {agentControls.map(([label, body]) => (
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
                For UI work, ask Uniqus to verify desktop and mobile states. For backend
                work, ask it to run focused tests or exercise the relevant endpoint.
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
            {configItems.map((item) => (
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
            Guest work is saved on this device. Sign in with Google to keep it
            permanently across devices and to unlock GitHub and publishing.
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
              Treat each turn like a useful ticket for a careful engineer.
            </p>
          </div>
          <div className="doc-grid two">
            <article className="doc-example good">
              <div className="doc-card-label">Better first prompt</div>
              <p>
                Build a billing dashboard for a small SaaS founder so they can spot
                failed payments quickly. Use Next.js and the existing design tokens.
                Start with the overview screen, seed realistic mock data, run the app,
                and verify desktop and mobile layouts.
              </p>
            </article>
            <article className="doc-example">
              <div className="doc-card-label">Less useful</div>
              <p>Make me a dashboard.</p>
            </article>
          </div>
          <div className="doc-command-list">
            <div className="doc-command-row">
              <code>Goal</code>
              <span>Say who it is for and what success looks like.</span>
            </div>
            <div className="doc-command-row">
              <code>Context</code>
              <span>Name stack, files, data shape, screenshots, constraints, and examples.</span>
            </div>
            <div className="doc-command-row">
              <code>Scope</code>
              <span>Ask for one coherent slice, then iterate after you see it.</span>
            </div>
            <div className="doc-command-row">
              <code>Proof</code>
              <span>Ask for tests, preview checks, screenshots, or command output.</span>
            </div>
          </div>
          <div className="doc-template">
            <div className="label-micro">Copyable template</div>
            <p>
              Build [what] for [who] so they can [goal]. Use [stack or
              constraints]. Start with [first screen or workflow]. Use
              [attached files or @file references] as source material. Run [tests or
              preview] and tell me what you verified.
            </p>
          </div>
        </section>

        <section id="troubleshoot" className="doc-section" aria-labelledby="troubleshoot-title">
          <div className="doc-section-head">
            <p className="doc-kicker">10</p>
            <h2 id="troubleshoot-title">Troubleshooting</h2>
            <p>Most problems get easier when you give the agent the exact symptom and the evidence.</p>
          </div>
          <div className="doc-grid two">
            {troubleshooting.map((item) => (
              <article key={item.title} className="doc-card compact">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
