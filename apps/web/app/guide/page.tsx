import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";

export const metadata = {
  title: "User guide · Uniqus Code",
};

/**
 * In-app user guide (#6). Static, auth-free documentation reachable from the
 * dashboard sidebar. Two halves: "how to use the app" (the surfaces and what
 * each does) and "how to prompt the agent well" (concrete, copy-pasteable
 * habits). Kept as a server component — no interactivity needed.
 */
export default function GuidePage() {
  return (
    <>
      <nav className="topnav">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <BrandLockup />
          </Link>
        </div>
        <div className="right">
          <Link href="/projects" className="btn-ghost" style={{ fontSize: 12 }}>
            ← Back to projects
          </Link>
        </div>
      </nav>

      <div className="doc-shell">
        <aside className="doc-toc">
          <div className="label-micro">On this page</div>
          <a href="#start">Getting started</a>
          <a href="#new">Creating a project</a>
          <a href="#chat">Chatting with the agent</a>
          <a href="#plan">Plan mode</a>
          <a href="#run">Running & previewing</a>
          <a href="#files">Files, editor & terminal</a>
          <a href="#tools">Skills, Secrets & Rewind</a>
          <a href="#deploy">Deploying</a>
          <a href="#prompting">Prompting the agent well</a>
        </aside>

        <main className="doc">
          <h1>Using Uniqus Code</h1>
          <p className="doc-lede">
            Uniqus Code is an AI engineer that builds and edits real projects for
            you. You describe what you want in chat; the agent writes the files,
            runs commands, starts a live preview, and reports back. This guide
            covers each surface and how to get the best results.
          </p>

          <section id="start">
            <h2>Getting started</h2>
            <p>
              From the dashboard, start a new project (see below) or open an
              existing one. Each project is an isolated sandbox with its own
              files, chat history, and dev server. Your work is saved
              automatically — you can close the tab and come back later.
            </p>
          </section>

          <section id="new">
            <h2>Creating a project</h2>
            <p>There are four ways to start, shown as tabs on the dashboard:</p>
            <ul>
              <li>
                <strong>Blank project</strong> — just names an empty project and
                opens it. Nothing is sent to the agent until you type your first
                message. Use this when you want to write the opening prompt
                yourself in the workspace.
              </li>
              <li>
                <strong>Describe in detail</strong> — write a paragraph about what
                you want. Uniqus picks a sensible project name, refines your text
                into a strong first prompt, and the agent starts working
                immediately on the next screen.
              </li>
              <li>
                <strong>Upload .zip</strong> — bring an existing codebase (up to
                250&nbsp;MB). <code>.git/</code> and <code>node_modules/</code> are
                stripped on import.
              </li>
              <li>
                <strong>Clone GitHub</strong> — import a repo by connecting GitHub
                (pick from your repos) or pasting a URL/PAT for a one-off clone.
              </li>
            </ul>
            <p className="doc-tip">
              Blank vs. Describe: Blank = “open an empty project, I’ll prompt it
              myself.” Describe = “here’s the idea, start building.” They differ
              only in whether a first turn is sent for you.
            </p>
          </section>

          <section id="chat">
            <h2>Chatting with the agent</h2>
            <p>
              The chat panel (left) is where you talk to the agent. Type a request
              and press <kbd>Enter</kbd> (<kbd>Shift</kbd>+<kbd>Enter</kbd> for a
              newline). While it works you’ll see its tool calls (file writes,
              commands, searches) stream in; completed turns collapse so the
              thread stays readable.
            </p>
            <ul>
              <li>
                <strong>Attach files</strong> — drag &amp; drop, paste, or use the
                Files button to add images, PDFs, CSVs, or design references the
                agent can use.
              </li>
              <li>
                <strong>@-mention files</strong> — type <code>@</code> to reference
                a file in your project so the agent reads it.
              </li>
              <li>
                <strong>Slash commands</strong> — type <code>/</code> to run
                built-in or project commands.
              </li>
              <li>
                <strong>Stop</strong> — cancel a turn mid-flight; partial work is
                kept.
              </li>
            </ul>
          </section>

          <section id="plan">
            <h2>Plan mode</h2>
            <p>
              With the <strong>Plan</strong> toggle on, the agent first proposes a
              structured plan — a summary plus concrete steps — that you can edit
              and approve before it touches any files. It’s on by default for a
              brand-new project’s first turn and off afterward; flip it whenever
              you like.
            </p>
            <p>
              You don’t have to remember to turn it on: if you ask for something
              large or risky (a new app, a multi-file feature, a big refactor)
              without plan mode, the agent can switch into plan mode itself and
              show you a plan to approve before making changes.
            </p>
          </section>

          <section id="run">
            <h2>Running &amp; previewing</h2>
            <p>
              Click <strong>Run</strong> in the topbar to start (or restart) the
              project’s dev server. Dependencies install automatically the first
              time, then a live preview opens in the editor area. The agent can
              also start a preview itself as part of its work — you’ll get a
              preview tab and a public URL. You never need to run terminal
              commands yourself.
            </p>
          </section>

          <section id="files">
            <h2>Files, editor &amp; terminal</h2>
            <p>
              Toggle the <strong>Files</strong> panel to browse the project tree
              and open files in the editor — you can edit directly and your
              changes save automatically. The <strong>Logs</strong> panel shows
              command output. The agent and your edits share the same sandbox, so
              changes from either side are visible to both.
            </p>
          </section>

          <section id="tools">
            <h2>Skills, Secrets &amp; Rewind</h2>
            <ul>
              <li>
                <strong>Skills</strong> — a per-project instructions file prepended
                to the agent’s system prompt. Put conventions here (“use Tailwind,”
                “match the existing design tokens,” “tests go in <code>__tests__</code>”)
                so you don’t repeat them every message.
              </li>
              <li>
                <strong>Secrets</strong> — store API keys encrypted. The agent
                gets values only through a controlled mechanism and never sees
                them in plain text in chat.
              </li>
              <li>
                <strong>Rewind</strong> — the agent checkpoints after meaningful
                changes; browse and restore a previous state if a change went the
                wrong way.
              </li>
            </ul>
          </section>

          <section id="deploy">
            <h2>Deploying</h2>
            <p>
              Use <strong>Deploy</strong> in the topbar to publish to Vercel
              (connect your account once), and <strong>Create GitHub repo</strong>
              to push the project to GitHub. Both live in the workspace topbar.
            </p>
          </section>

          <section id="prompting">
            <h2>Prompting the agent well</h2>
            <p>
              The agent is capable but not telepathic. A little structure goes a
              long way:
            </p>
            <ul>
              <li>
                <strong>State the goal, not just the task.</strong> “Build a
                dashboard that shows our weekly signups so the team can spot dips”
                beats “make a chart.” The why guides a hundred small choices.
              </li>
              <li>
                <strong>Give specifics it can’t guess.</strong> Framework, data
                source, who uses it, must-have fields, example values, brand
                colors. Attach a screenshot or design if you have one.
              </li>
              <li>
                <strong>One coherent change per message.</strong> Ship a working
                slice, look at it, then ask for the next thing. Giant
                everything-at-once prompts are harder to get right and harder to
                review.
              </li>
              <li>
                <strong>Use plan mode for big or fuzzy asks.</strong> Reviewing a
                plan for 30 seconds is cheaper than undoing a wrong direction.
              </li>
              <li>
                <strong>Point at examples.</strong> <code>@</code>-mention a file
                and say “match this pattern,” or “make it look like the attached
                screenshot.”
              </li>
              <li>
                <strong>Ask it to verify.</strong> “Start the preview and check it
                renders at mobile and desktop sizes” gets you a screenshot and a
                self-check, not just a claim.
              </li>
              <li>
                <strong>When something’s wrong, describe the symptom precisely.</strong>{" "}
                “The submit button does nothing and the console shows a 404 on
                /api/save” is far more actionable than “it’s broken.”
              </li>
              <li>
                <strong>For current facts, tell it to search.</strong> Model names,
                library versions, and pricing change — “use web search to confirm
                the latest models before listing them” prevents stale output.
              </li>
            </ul>
            <p className="doc-tip">
              A good first message template: <em>“Build [what] for [who] so they
              can [goal]. Use [stack/constraints]. Start with [the core screen],
              wire it to [data], and show me a preview.”</em>
            </p>
          </section>

          <p className="doc-foot">
            <Link href="/projects">← Back to your projects</Link>
          </p>
        </main>
      </div>
    </>
  );
}
