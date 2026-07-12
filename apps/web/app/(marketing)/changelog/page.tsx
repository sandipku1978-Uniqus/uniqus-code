import ChangelogNav, { type ChangelogNavEntry } from "@/components/ChangelogNav";

type Tag = "new" | "improved" | "fixed";

export const metadata = {
  title: "Changelog — Uniqus Code",
  description:
    "Product updates, big and small. See what's new in Uniqus Code — from multi-provider models and built-in web search to refresh-proof builds, plain-English plans, per-run costs, and bring-your-own model keys.",
};

interface Entry {
  id: string;
  date: string;
  ver: string;
  title: string;
  changes: { tag: Tag; text: string }[];
}

/**
 * Pre-v1: the product isn't in production yet, so every entry stays below
 * v1.0. Versions and dates are ordered oldest (v0.1) to newest, then
 * reversed for display so the newest entry renders first.
 */
const ENTRIES: Entry[] = [
  {
    id: "v0-1",
    date: "Apr 2026",
    ver: "v0.1",
    title: "A browser workspace that runs your code",
    changes: [
      {
        tag: "new",
        text: "A full in-browser workspace: an editor, a live file tree, and a chat panel where the agent writes and edits real files.",
      },
      {
        tag: "new",
        text: "One-click Run — start your dev server without typing a command, with a live preview right inside the workspace.",
      },
      {
        tag: "new",
        text: "Import an existing codebase by uploading a .zip or cloning straight from GitHub.",
      },
      {
        tag: "improved",
        text: "Agent responses stream in as they're written instead of appearing all at once, and completed turns collapse to keep the chat readable.",
      },
      {
        tag: "new",
        text: "A Stop button cancels a running agent turn — and any command it kicked off — instantly.",
      },
      {
        tag: "fixed",
        text: "Early reliability fixes: preview links reach the running app in production, dependencies auto-install after a redeploy, and the editor no longer freezes on certain files.",
      },
    ],
  },
  {
    id: "v0-2",
    date: "May 2026",
    ver: "v0.2",
    title: "Locking the front door",
    changes: [
      {
        tag: "improved",
        text: "Hardened request handling — cross-origin access is now allowlisted, and file paths and imported repos are validated so a project can't reach outside its own sandbox.",
      },
      {
        tag: "fixed",
        text: "Fixed a bug that could permanently break a project's chat if you clicked Stop at the wrong moment, with an automatic one-time repair for anyone already affected.",
      },
      {
        tag: "fixed",
        text: "Previews of multi-page apps no longer 404 or lose live-reload when you click through internal links.",
      },
      {
        tag: "new",
        text: "Connect GitHub with one click — pick a repo from a dropdown instead of pasting a URL and access token — and deploy straight to Vercel from the workspace toolbar.",
      },
    ],
  },
  {
    id: "v0-3",
    date: "May 2026",
    ver: "v0.3",
    title: "Every project gets its own machine",
    changes: [
      {
        tag: "new",
        text: "Each project now runs in its own fully isolated machine instead of a shared process — stronger isolation, and the groundwork for supporting more than just Node.",
      },
      {
        tag: "new",
        text: "Encrypted per-project secrets, starter connectors (Slack, HTTP, Postgres, GitHub), and automatic checkpoints before every change, with a Rewind view to step back.",
      },
      {
        tag: "new",
        text: "Skills and slash commands (/review, /deploy, /explain, /test) teach the agent your project's conventions.",
      },
      {
        tag: "new",
        text: "Free guest accounts — start building with no Google or email sign-in required, with a recovery code to restore your work on another device later.",
      },
      {
        tag: "improved",
        text: "Long-running installs and commands no longer freeze the workspace or let an idle project drop mid-task.",
      },
    ],
  },
  {
    id: "v0-4",
    date: "May 2026",
    ver: "v0.4",
    title: "A workspace that feels considered",
    changes: [
      {
        tag: "improved",
        text: "Renamed the agent from Codex to Uniqus across the whole product.",
      },
      {
        tag: "new",
        text: "Drag-and-drop and paste-to-upload for files, @file autocomplete in chat, and an image viewer plus Markdown preview in the editor.",
      },
      {
        tag: "new",
        text: "The agent can now see screenshots and images you give it, not just describe them blind.",
      },
      {
        tag: "improved",
        text: "File and folder icons match familiar editor styling, and preview error pages are styled instead of raw browser errors.",
      },
    ],
  },
  {
    id: "v0-5",
    date: "May 2026",
    ver: "v0.5",
    title: "Make it yours",
    changes: [
      {
        tag: "new",
        text: "Settings gained real teeth — light/dark theme, comfortable/compact density, and account-wide custom instructions and default skills that apply to every new project.",
      },
      {
        tag: "new",
        text: "A proper Guide and Settings page, a bigger dashboard with example prompts and starter templates, and one-sentence project creation — just describe it.",
      },
      {
        tag: "improved",
        text: "A broad visual cleanup — undefined color tokens, inconsistent modals, mismatched type sizes, and low-contrast focus states, all fixed.",
      },
      {
        tag: "fixed",
        text: "Verified every model's reasoning controls against current provider docs and corrected several that were silently failing; added a live \"thinking\" trace you can expand while the agent reasons.",
      },
    ],
  },
  {
    id: "v0-6",
    date: "May 2026",
    ver: "v0.6",
    title: "The agent can read the live web",
    changes: [
      {
        tag: "new",
        text: "Built-in web search across every model provider, so the agent can pull current docs instead of relying on stale training data.",
      },
      {
        tag: "new",
        text: "Plan mode now investigates your actual codebase with read-only tools before proposing a plan, streaming its progress as it works.",
      },
      {
        tag: "improved",
        text: "Faster reopening of a recently-used project — the environment underneath stays warm for a day instead of rebuilding cold every time.",
      },
      {
        tag: "new",
        text: "A live token counter in the composer, and a usage dashboard — tokens, estimated cost, agent time, top models — right on your home screen.",
      },
    ],
  },
  {
    id: "v0-7",
    date: "May 2026",
    ver: "v0.7",
    title: "A workspace that holds up",
    changes: [
      {
        tag: "new",
        text: "Preview annotator: click anywhere in the live preview to mark what you mean, then describe the change — no more hunting for the right words.",
      },
      {
        tag: "new",
        text: "Error boundaries across the workspace catch a failing panel before it takes the whole session down.",
      },
      {
        tag: "improved",
        text: "The workspace is now usable on a phone.",
      },
      {
        tag: "fixed",
        text: "Preview 502s caused by dev servers binding only to localhost are resolved.",
      },
      {
        tag: "new",
        text: "A landing-page composer with voice input — describe your idea out loud from the marketing site, and it carries straight through sign-in into a new workspace.",
      },
    ],
  },
  {
    id: "v0-8",
    date: "Jun 2026",
    ver: "v0.8",
    title: "A hardening pass",
    changes: [
      {
        tag: "improved",
        text: "A full security and UX audit: closed several data-exposure gaps (including a subtle cross-network request bypass), added baseline rate limiting and security headers for guest accounts, and rebuilt toasts and modals on one shared, accessible primitive.",
      },
    ],
  },
  {
    id: "v0-9",
    date: "Jun 2026",
    ver: "v0.9",
    title: "Bring your own data, bring your own design",
    changes: [
      {
        tag: "new",
        text: "Connect a Supabase project in a couple of clicks — Uniqus provisions the database and stores the keys for you.",
      },
      {
        tag: "new",
        text: "Design Systems: generate a full token set — colors, type, components — from a brief, an existing project, a live URL, a Figma file, or an upload, with a live preview styled in your own tokens.",
      },
      {
        tag: "new",
        text: "A Databases tab — browse tables, run SQL, and manage your connected database without leaving the workspace.",
      },
      {
        tag: "new",
        text: "A Skills library — save reusable skills at the account level, generate new ones with AI, and reuse them across projects.",
      },
      {
        tag: "improved",
        text: "A 46-finding security and correctness audit closed a symlink-based file-read bug, several cross-network request gaps, and a handful of workspace race conditions.",
      },
    ],
  },
  {
    id: "v0-10",
    date: "Jun 2026",
    ver: "v0.10",
    title: "Bring your keys, take your code",
    changes: [
      {
        tag: "new",
        text: "Bring your own model keys — connect your Anthropic, OpenAI, or Google account in Settings and route your builds through it, so usage (including planning) bills to you. Leave it blank and we use ours.",
      },
      {
        tag: "new",
        text: "Take your code anywhere: download your whole project as a zip, or drop your live app into any page with a ready-made embed snippet.",
      },
      {
        tag: "new",
        text: "Share a live preview with a teammate over a link that expires and that you can revoke at any time — no sign-in required to view.",
      },
      {
        tag: "improved",
        text: "A clearer Security page: a new request-flow diagram, plus straight answers on sub-processors, encryption, data handling, and exactly where we stand on certifications.",
      },
    ],
  },
  {
    id: "v0-11",
    date: "Jun 2026",
    ver: "v0.11",
    title: "Built for teams",
    changes: [
      {
        tag: "new",
        text: "Real collaboration — invite teammates to a project as owner, admin, editor, or viewer, leave comments, and share an organization workspace.",
      },
      {
        tag: "new",
        text: "Attach knowledge documents — PDFs, spreadsheets, Word docs — for the agent to read as project context.",
      },
      {
        tag: "new",
        text: "A templates library to start a new project from a working example instead of a blank page.",
      },
      {
        tag: "new",
        text: "A new agent tool lets it drive your running preview itself and report back what it saw — console errors, failed requests, accessibility issues — as concrete evidence instead of a guess.",
      },
      {
        tag: "improved",
        text: "Verified and hardened the whole collaboration feature set before shipping, including a cross-network request bypass in the new preview-driving tool.",
      },
    ],
  },
  {
    id: "v0-12",
    date: "Jun 2026",
    ver: "v0.12",
    title: "Generate images, watch the agent drive the preview",
    changes: [
      {
        tag: "new",
        text: "The agent can now generate and edit images directly and use the result immediately, with the cost metered per image.",
      },
      {
        tag: "new",
        text: "A live \"Preview (Agent)\" view streams a screenshot for every step while the agent drives your running app; save a sequence of steps as a reusable flow to run again later.",
      },
      {
        tag: "improved",
        text: "Team features — Teams/Organizations, Comments, Tasks — are now visible in the UI.",
      },
      {
        tag: "improved",
        text: "File icons now use VS Code's real Seti icon set for a more familiar look.",
      },
      {
        tag: "fixed",
        text: "A thinking-effort bug on one Gemini model that occasionally produced blank, one-word answers is resolved.",
      },
    ],
  },
  {
    id: "v0-13",
    date: "Jun 2026",
    ver: "v0.13",
    title: "GLM joins the lineup",
    changes: [
      {
        tag: "new",
        text: "Z.ai's GLM-5.2 is now a first-class model — near-Opus coding quality at a fraction of the cost, with a 1M-token context. Auto reaches for it on routine features, and you can pin it per turn from the composer's model picker.",
      },
      {
        tag: "new",
        text: "Because GLM can't see images natively, a vision bridge quietly hands screenshots to a companion model, so the agent never loses the ability to check its own visual work.",
      },
      {
        tag: "new",
        text: "Built-in web search now covers GLM too, so all four providers — Claude, GLM, GPT, and Gemini — can pull current docs mid-build.",
      },
      {
        tag: "new",
        text: "Bring your own Z.ai key in Settings alongside Anthropic, OpenAI, and Google, and route your GLM builds through your own account.",
      },
    ],
  },
  {
    id: "v0-14",
    date: "Jun 2026",
    ver: "v0.14",
    title: "Guardrails you control",
    changes: [
      {
        tag: "new",
        text: "Four permission modes — Plan, Ask before edits, Auto-accept, and Full autonomy — let you decide how much the agent can do without checking in, switchable mid-conversation.",
      },
      {
        tag: "new",
        text: "Task-aware Auto routing sends each step of a turn to whichever model fits it best — quick edits to the fastest model, hard problems to the strongest reasoner — instead of one fixed choice.",
      },
      {
        tag: "new",
        text: "A build-readiness check the agent can run before calling a project deployable, catching production build failures and unsafe serverless patterns first.",
      },
      {
        tag: "new",
        text: "The agent can now split work across sub-agents that each take a piece of a larger task.",
      },
      {
        tag: "improved",
        text: "Reading large files and searching code got smarter — the agent can request just the lines it needs and recovers gracefully from a bad search pattern instead of failing outright.",
      },
      {
        tag: "fixed",
        text: "GLM's web search was silently returning stale, un-searched answers — it now actually searches every time.",
      },
    ],
  },
  {
    id: "v0-15",
    date: "Jun 2026",
    ver: "v0.15",
    title: "Watch the agent work",
    changes: [
      {
        tag: "new",
        text: "A live Activity Monitor shows token and cost stats, sub-agent progress, and your task list updating in real time as a turn runs.",
      },
      {
        tag: "new",
        text: "Sub-agents now run concurrently in the background instead of one at a time, so multi-part builds finish faster.",
      },
      {
        tag: "new",
        text: "Thinking effort is now a full draggable slider (low through max, scoped to what each model actually supports), with a one-click on/off toggle.",
      },
      {
        tag: "new",
        text: "When Auto picks a model for you, a chip shows which one it chose before the response starts streaming.",
      },
      {
        tag: "new",
        text: "Send a follow-up message while the agent is still working — it's picked up as steering instructions instead of being rejected as \"already running\".",
      },
      {
        tag: "new",
        text: "Set default skills that apply automatically to every new project you create.",
      },
    ],
  },
  {
    id: "v0-16",
    date: "Jul 2026",
    ver: "v0.16",
    title: "Plans, changes, and costs you can read",
    changes: [
      {
        tag: "new",
        text: "Plan review rebuilt for a non-technical reader: a plain-English headline, a \"What you'll get\" list, and a wireframe up front, with every technical detail one click away behind a \"Technical details\" toggle.",
      },
      {
        tag: "improved",
        text: "Tool activity in chat now updates live instead of freezing on \"Running…\" — file writes and edits show a live line-diff estimate as they stream, then flip to past tense (\"Wrote\", \"Ran\") on completion.",
      },
      {
        tag: "improved",
        text: "The model picker is now a compact, traditional menu instead of a large panel.",
      },
      {
        tag: "fixed",
        text: "Reopening a project whose app lives in a subdirectory no longer gets stuck in a flashing \"compiling\" loop before erroring out.",
      },
      {
        tag: "improved",
        text: "A broad prompt-quality pass and a full rewrite of every design skill pack — 17 refreshed, 8 new, including dark/gaming, luxury, and terminal aesthetics — for sharper, more differentiated output.",
      },
    ],
  },
  {
    id: "v0-17",
    date: "Jul 2026",
    ver: "v0.17",
    title: "Numbers that move in real time",
    changes: [
      {
        tag: "new",
        text: "Live output-token and cost counters now tick up as the agent writes, instead of jumping only when a turn finishes.",
      },
      {
        tag: "improved",
        text: "Reopening a project you've built recently is now consistently under a second — we found and closed two separate causes of a roughly one-second stall in the environment underneath.",
      },
      {
        tag: "fixed",
        text: "Fixed a bug where switching models mid-conversation could quietly corrupt Gemini's reasoning state; also surfaced Gemini 3.5 Flash's web searches as visible activity instead of hiding them.",
      },
      {
        tag: "improved",
        text: "The live +/− line-diff estimate on a file edit now counts up smoothly toward the real number instead of overshooting and snapping back.",
      },
    ],
  },
  {
    id: "v0-18",
    date: "Jul 2026",
    ver: "v0.18",
    title: "The numbers add up",
    changes: [
      {
        tag: "fixed",
        text: "Per-run cost estimates are more accurate: generating images, reading images, and reading documents now count toward the cost shown for a turn instead of being invisible, and several model prices were corrected against each provider's current published rates.",
      },
      {
        tag: "fixed",
        text: "After you rewind to an earlier checkpoint, the agent now re-reads your files before editing instead of acting on changes that were rolled back.",
      },
      {
        tag: "improved",
        text: "Deleting a large project now shows a spinner and keeps the dialog open until it finishes, so it no longer looks like nothing happened.",
      },
      {
        tag: "improved",
        text: "The \"Reconnected — your build kept running\" banner can now be dismissed and clears itself automatically.",
      },
    ],
  },
  {
    id: "v0-19",
    date: "Jul 2026",
    ver: "v0.19",
    title: "Sources you can follow",
    changes: [
      {
        tag: "new",
        text: "Answers grounded in web search now show clickable citations in the text and a clean source list underneath, including after you reopen a conversation.",
      },
      {
        tag: "new",
        text: "The all-projects view can now filter by deploy status and sort by name, recent activity, or creation date.",
      },
      {
        tag: "improved",
        text: "Workspace members, usage, and settings pages have been refreshed with clearer summaries, controls, and budget status.",
      },
      {
        tag: "improved",
        text: "Plan mode now sees the same up-to-date project context as the building agent, including attached design systems, knowledge, connectors, and running apps.",
      },
      {
        tag: "fixed",
        text: "Skill instructions arriving inside an imported ZIP or GitHub project are held for review until you explicitly save them in Uniqus.",
      },
    ],
  },
  {
    id: "v0-20",
    date: "Jul 2026",
    ver: "v0.20",
    title: "A faster, steadier agent",
    changes: [
      {
        tag: "new",
        text: "GPT-5.6 Sol and GPT-5.6 Terra are now available in the model picker, with the full reasoning range on both models.",
      },
      {
        tag: "improved",
        text: "The agent now starts eligible tasks with a smaller, task-matched toolkit and loads specialized capabilities only when needed, cutting prompt overhead while keeping the full toolset within reach.",
      },
      {
        tag: "improved",
        text: "Independent code reads can run in parallel, while large files, searches, and command output are trimmed intelligently so one oversized result cannot crowd out the rest of the work.",
      },
      {
        tag: "improved",
        text: "Long conversations compact around each model's real context window and reuse that compacted history after reconnecting, reducing repeated work on later turns.",
      },
      {
        tag: "fixed",
        text: "File changes and chat history are saved more reliably at the end of every turn, including interrupted runs and background tasks that hit a provider or persistence error.",
      },
    ],
  },
  {
    id: "v0-21",
    date: "Jul 2026",
    ver: "v0.21",
    title: "Cleaner workspaces, more reliable previews",
    changes: [
      {
        tag: "improved",
        text: "The website and project dashboard now use cleaner, flatter surfaces, while organization members, usage, and settings have been rebuilt as proper workspace tools instead of generic admin cards.",
      },
      {
        tag: "fixed",
        text: "Preview dependencies now stay in sync with package.json and lockfile changes, including apps inside subdirectories, so stale or partially installed modules no longer masquerade as a ready project.",
      },
      {
        tag: "fixed",
        text: "New projects use a current Node.js runtime and reject incompatible packages during installation instead of accepting them and failing later when the preview starts.",
      },
    ],
  },
  {
    id: "v0-22",
    date: "Jul 2026",
    ver: "v0.22",
    title: "A more consistent finish",
    changes: [
      {
        tag: "improved",
        text: "The new-project composer now matches the workspace chat surface, and marketing footers once again use a softly translucent gray panel.",
      },
    ],
  },
];

const DISPLAY_ENTRIES = [...ENTRIES].reverse();

const NAV_ENTRIES: ChangelogNavEntry[] = DISPLAY_ENTRIES.map((entry) => ({
  href: `#${entry.id}`,
  date: entry.date,
  ver: entry.ver,
}));

export default function ChangelogPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Changelog
          </span>
          <h1>
            What&rsquo;s <span className="grad">new</span>.
          </h1>
          <p className="mk-lede">
            Product updates, big and small — pre-v1 and building fast.
          </p>
        </div>
      </section>

      <section className="mk-page wide">
        <div className="mk-changelog-layout">
          <ChangelogNav entries={NAV_ENTRIES} />

          <div className="changelog">
            {DISPLAY_ENTRIES.map((entry) => (
              <div className="changelog-entry" key={entry.ver} id={entry.id}>
                <div className="changelog-date">
                  {entry.date}
                  <br />
                  <span className="ver">{entry.ver}</span>
                </div>
                <div className="changelog-body">
                  <h3>{entry.title}</h3>
                  <ul>
                    {entry.changes.map((change) => (
                      <li key={change.text}>
                        <span className={`change-tag tag-${change.tag}`}>
                          {change.tag}
                        </span>
                        <span>{change.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
