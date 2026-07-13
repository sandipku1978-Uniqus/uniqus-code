import Link from "next/link";

export const metadata = {
  title: "Community — Gate 15",
  description:
    "Join the Gate 15 community: trade ideas in the forum and Discord, follow along on GitHub and X, share what you built, and shape what we build next.",
};

type Icon =
  | "chat"
  | "github"
  | "x"
  | "gallery"
  | "calendar"
  | "changelog";

function ChannelIcon({ name }: { name: Icon }) {
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
    case "chat":
      return (
        <svg {...p}>
          <path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1-4.5A8 8 0 1 1 21 12Z" />
          <path d="M8.5 11h7M8.5 14h4.5" />
        </svg>
      );
    case "github":
      return (
        <svg {...p}>
          <path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.3 3.4 5.3 3.7 5.3 3.7a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.9 10c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22" />
        </svg>
      );
    case "x":
      return (
        <svg {...p}>
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      );
    case "gallery":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M3 14l5-4 4 3 3-2 6 5" />
          <circle cx="8.5" cy="8.5" r="1.4" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 3v4M16 3v4M12 13v4M9.5 15.5h5" />
        </svg>
      );
    case "changelog":
      return (
        <svg {...p}>
          <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M8.5 13h7M8.5 16.5h4.5" />
        </svg>
      );
  }
}

type Channel = {
  icon: Icon;
  iconClass: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  external?: boolean;
};

const CHANNELS: Channel[] = [
  {
    icon: "chat",
    iconClass: "grad",
    title: "Community forum & Discord",
    body: "Hang out with other builders in real time. Ask questions, swap prompts and skills, and get unstuck with people building the same way you are.",
    href: "https://discord.gg/gate15",
    cta: "Join the Discord",
    external: true,
  },
  {
    icon: "github",
    iconClass: "purple",
    title: "GitHub discussions",
    body: "Track our public roadmap, file ideas, and talk through the rough edges with the team as we ship.",
    href: "https://github.com/gate15/gate15/discussions",
    cta: "Open discussions",
    external: true,
  },
  {
    icon: "x",
    iconClass: "cyan",
    title: "X / Twitter",
    body: "Ship-logs, demos, and quick tips on getting the most out of Auto routing and the four model providers. Tag us in what you make.",
    href: "https://x.com/gate15",
    cta: "Follow @gate15",
    external: true,
  },
  {
    icon: "gallery",
    iconClass: "green",
    title: "Templates & showcase",
    body: "Browse projects the community started from a single prompt, then remix them into your own private workspace in a couple of clicks.",
    href: "/templates",
    cta: "Explore templates",
  },
  {
    icon: "calendar",
    iconClass: "amber",
    title: "Office hours",
    body: "Drop into a live session to watch real builds, ask the team anything, and see plan mode, checkpoints, and one-click deploys up close.",
    href: "https://discord.gg/gate15",
    cta: "See the schedule",
    external: true,
  },
  {
    icon: "changelog",
    iconClass: "",
    title: "Changelog",
    body: "Every shipped improvement, in plain English. See what's new across the agent, providers, preview, and deploys — and what landed because you asked.",
    href: "/changelog",
    cta: "Read the changelog",
  },
];

type Way = { title: string; body: string };

const WAYS: Way[] = [
  {
    title: "Share what you built",
    body: "Post a project, a screen recording, or a before-and-after. Showing your work is the fastest way to inspire the next builder — and to get sharp feedback on yours.",
  },
  {
    title: "Help someone get unstuck",
    body: "Answer a question in the forum or Discord. Your fix for a tricky preview bind or a gnarly deploy is exactly what the next person is searching for.",
  },
  {
    title: "Request features & report bugs",
    body: "Tell us what's missing. We read every thread and a lot of the changelog comes straight from the community — including the parts that ship the same week.",
  },
  {
    title: "Contribute templates & skills",
    body: "Package a great starting point — a template, a reusable skill, or a design pack — so others can launch from it. Good starters make everyone faster.",
  },
];

export default function CommunityPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Community
          </span>
          <h1>
            Build <span className="grad">together</span>.
          </h1>
          <p className="mk-lede">
            Gate 15 is more fun with company. Trade prompts and skills, show off
            what you shipped, get unstuck fast, and help shape what we build
            next — whichever AI you build with.
          </p>
          <div className="mk-hero-cta">
            <a
              href="https://discord.gg/gate15"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary btn-lg"
            >
              Join the Discord
            </a>
            <Link href="/templates" className="btn-secondary btn-lg">
              Browse templates
            </Link>
          </div>
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head">
          <span className="label-eyebrow">Where to find us</span>
          <h2>Pick the room that fits.</h2>
          <p>
            Quick question or a half-finished idea — there&rsquo;s a place for
            both. Everything below is open to builders on every plan.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {CHANNELS.map((c) => (
            <article className="mk-card hover" key={c.title}>
              <span className={`mk-ic ${c.iconClass}`}>
                <ChannelIcon name={c.icon} />
              </span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
              <div className="mk-card-foot">
                {c.external ? (
                  <a
                    href={c.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--accent-text)",
                      fontWeight: 600,
                      fontSize: 13.5,
                      textDecoration: "none",
                    }}
                  >
                    {c.cta} &rarr;
                  </a>
                ) : (
                  <Link
                    href={c.href}
                    style={{
                      color: "var(--accent-text)",
                      fontWeight: 600,
                      fontSize: 13.5,
                      textDecoration: "none",
                    }}
                  >
                    {c.cta} &rarr;
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Ways to get involved</span>
          <h2>The community runs on small contributions.</h2>
          <p>
            You don&rsquo;t need to be an expert to add something. Here are four
            easy ways to give back the week you start.
          </p>
        </div>
        <div className="mk-grid cols-2">
          {WAYS.map((w) => (
            <article className="mk-card" key={w.title}>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page narrow">
        <div
          className="mk-card"
          style={{
            alignItems: "center",
            textAlign: "center",
            padding: "44px 32px",
            borderColor:
              "color-mix(in srgb, var(--brand-ember) 40%, var(--mk-line))",
            background:
              "linear-gradient(160deg, color-mix(in srgb, var(--brand-ember) 12%, transparent), transparent 60%), color-mix(in srgb, var(--mk-panel-solid) 82%, transparent)",
          }}
        >
          <span className="label-eyebrow">Showcase</span>
          <h3
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              margin: "12px 0 10px",
              maxWidth: "22ch",
            }}
          >
            Built something you&rsquo;re proud of? Show it off.
          </h3>
          <p style={{ maxWidth: "52ch", marginBottom: 0 }}>
            From a single prompt to a deployed app — the best demos start as
            community projects. Add yours to the showcase, or remix a template
            and make it your own.
          </p>
          <div style={{ marginTop: 24 }}>
            <Link href="/templates" className="btn-primary">
              Share your project
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
