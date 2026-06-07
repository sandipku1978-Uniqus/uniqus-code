type Tag = "new" | "improved" | "fixed";

export const metadata = {
  title: "Changelog — Uniqus Code",
  description:
    "Product updates, big and small. See what's new in Uniqus Code — from multi-provider models and built-in web search to faster cold starts and a more resilient workspace.",
};

const ENTRIES: {
  date: string;
  ver: string;
  title: string;
  changes: { tag: Tag; text: string }[];
}[] = [
  {
    date: "Jun 2026",
    ver: "v1.6",
    title: "Pick the AI you trust, per turn",
    changes: [
      {
        tag: "new",
        text: "Multi-provider models: build with Claude, GPT, or Gemini and switch between them right from the composer's model picker — or set an account-wide default in Settings.",
      },
      {
        tag: "new",
        text: "Auto routing stays the default, sending each step to the model best suited for it so you don't have to think about it unless you want to.",
      },
      {
        tag: "new",
        text: "Thinking effort — low, medium, or high — is now a control in the model picker, so you can trade speed for depth on the turns that need it.",
      },
    ],
  },
  {
    date: "May 2026",
    ver: "v1.5",
    title: "The agent can read the live web",
    changes: [
      {
        tag: "new",
        text: "Built-in web search across Claude, GPT, and Gemini. The agent can pull current docs and references mid-build, and every search shows up as its own activity in the timeline.",
      },
      {
        tag: "improved",
        text: "Search is advertised to the model only when the resolved provider actually supports it, so prompts stay honest and results stay reliable.",
      },
    ],
  },
  {
    date: "Apr 2026",
    ver: "v1.4",
    title: "A workspace that holds up",
    changes: [
      {
        tag: "improved",
        text: "Error boundaries across the workspace catch a failing panel before it takes the whole session down — you keep your chat, your preview, and your place.",
      },
      {
        tag: "improved",
        text: "A mobile-responsive layout means you can check a build, read the plan, and reply from your phone without fighting the UI.",
      },
      {
        tag: "fixed",
        text: "Preview 502s caused by dev servers binding to localhost are resolved — the system prompt now guides the agent to bind 0.0.0.0 so previews are reachable across the workspace boundary.",
      },
    ],
  },
  {
    date: "Mar 2026",
    ver: "v1.3",
    title: "See it, point at it, fix it",
    changes: [
      {
        tag: "new",
        text: "Preview annotator: click anywhere in the live preview to mark what you mean, then describe the change — no more hunting for the right words to locate an element.",
      },
      {
        tag: "new",
        text: "An iframe error bridge surfaces runtime errors from your running app straight into the chat, so the agent can react to what actually broke.",
      },
      {
        tag: "improved",
        text: "Checkpoints gained search and day grouping, making it far easier to find the exact restore point you want before you rewind.",
      },
    ],
  },
  {
    date: "Feb 2026",
    ver: "v1.2",
    title: "From idea to workspace in seconds",
    changes: [
      {
        tag: "new",
        text: "A landing-page composer with voice input: describe your idea out loud, then carry it straight through sign-in into a fresh private workspace.",
      },
      {
        tag: "improved",
        text: "Faster new-project cold start. A golden base snapshot restores a clone of a pre-booted machine, taking first boot from seconds toward sub-second — with a safe fall back to a cold boot if anything looks off.",
      },
    ],
  },
  {
    date: "Jan 2026",
    ver: "v1.1",
    title: "Out in the open, by default",
    changes: [
      {
        tag: "improved",
        text: "A security hardening pass tightened how secrets, previews, and connectors are handled, keeping risky actions behind your approval and raw secret values out of the model's reach.",
      },
      {
        tag: "fixed",
        text: "Closed gaps in workspace and preview-proxy access so each project stays sealed off in its own isolated machine.",
      },
      {
        tag: "improved",
        text: "Plan mode shows its work before it changes anything, and every plan, tool call, and result stays visible in a clear audit trail.",
      },
    ],
  },
];

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
          <p className="mk-lede">Product updates, big and small.</p>
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="changelog">
          {ENTRIES.map((entry) => (
            <div className="changelog-entry" key={entry.ver}>
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
                      <span className={`change-tag ${change.tag}`}>
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
      </section>
    </>
  );
}
