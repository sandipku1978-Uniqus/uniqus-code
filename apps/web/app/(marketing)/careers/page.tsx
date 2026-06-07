export const metadata = {
  title: "Careers — Uniqus Code",
  description:
    "Help build the future of software. Join a small, senior team shipping a frontier AI workspace where people describe what they want and watch it come to life.",
};

type Icon = "rocket" | "team" | "compass" | "globe" | "spark" | "growth";

function WhyIcon({ name }: { name: Icon }) {
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
    case "rocket":
      return (
        <svg {...p}>
          <path d="M5 15c-1.5 1-2 4-2 4s3-.5 4-2c.7-1 .6-2.3-.2-3-.8-.8-2-.9-3 .1Z" />
          <path d="M9 12l3 3c4-1.5 7-5 7-10 0 0-5 0-9 4l-3.5 3.5" />
          <path d="M9 12l-3-1 2-2 2 1" />
        </svg>
      );
    case "team":
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
          <path d="M16 4.5a3 3 0 0 1 0 6M17 15c2.6.4 4 2.3 4 5" />
        </svg>
      );
    case "compass":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z" />
        </svg>
      );
    case "globe":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
        </svg>
      );
    case "spark":
      return (
        <svg {...p}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
          <path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16Z" />
        </svg>
      );
    case "growth":
      return (
        <svg {...p}>
          <path d="M3 20h18" />
          <path d="M5 20v-5M10 20v-9M15 20v-6M20 20V8" />
          <path d="M4 9l4-3 3 2 5-5" />
        </svg>
      );
  }
}

const WHY: { icon: Icon; iconClass: string; title: string; body: string }[] = [
  {
    icon: "rocket",
    iconClass: "grad",
    title: "Work on a frontier AI product",
    body: "Uniqus Code turns plain-English ideas into running apps inside private cloud workspaces. You'll ship at the edge of what coding agents can do — routing across Claude, GPT, and Gemini, plan mode, live previews, and more.",
  },
  {
    icon: "team",
    iconClass: "purple",
    title: "A small, senior team",
    body: "We're a tight group of experienced engineers and designers. No layers, no busywork — just people who care about craft, talking directly and shipping things they're proud of.",
  },
  {
    icon: "compass",
    iconClass: "cyan",
    title: "Real ownership",
    body: "You'll own meaningful surfaces end to end, from the first sketch to the deploy. Decisions are made by the people closest to the work, not handed down through a chain of approvals.",
  },
  {
    icon: "globe",
    iconClass: "green",
    title: "Remote-friendly",
    body: "We work async-first across time zones, with overlap when it matters. Where you log in from is up to you — we care about what you build, not where you sit.",
  },
  {
    icon: "spark",
    iconClass: "amber",
    title: "Use the tools you build",
    body: "We build with our own product every day, alongside the latest AI tooling. Dogfooding keeps us honest and means your fixes land for real users — including yourself.",
  },
  {
    icon: "growth",
    iconClass: "",
    title: "Grow fast, with the company",
    body: "Early teams are where careers compound the quickest. As Uniqus Code grows, the people who built it get the first shot at leading what comes next.",
  },
];

const PERKS: { title: string; body: string }[] = [
  {
    title: "Remote-first",
    body: "Work from wherever you do your best thinking. We optimize for output and trust, not hours at a desk.",
  },
  {
    title: "Competitive equity",
    body: "Meaningful ownership in what we're building together, so the upside is shared by the people who create it.",
  },
  {
    title: "Learning budget",
    body: "A yearly stipend for books, courses, conferences, and anything that helps you get sharper at your craft.",
  },
  {
    title: "Top-tier hardware",
    body: "The machine and setup you need to do great work — pick what fits how you build best.",
  },
  {
    title: "Flexible time off",
    body: "Take the time you need to rest and come back recharged. We treat people like the adults they are.",
  },
  {
    title: "Latest AI tools",
    body: "Access to the frontier models and tooling we work with daily, so you're never building with one hand tied.",
  },
];

const ROLES: { title: string; team: string; type: string }[] = [
  { title: "Founding Frontend Engineer", team: "Engineering", type: "Full-time" },
  { title: "Backend / Infrastructure Engineer", team: "Engineering", type: "Full-time" },
  { title: "Product Designer", team: "Design", type: "Full-time" },
  { title: "Developer Advocate", team: "Community", type: "Full-time" },
  { title: "Member of Technical Staff", team: "Engineering", type: "Full-time" },
];

function applyHref(role: string) {
  return `mailto:careers@uniqus.com?subject=${encodeURIComponent(
    `Application: ${role}`
  )}`;
}

export default function CareersPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Careers
          </span>
          <h1>
            Help build the future of <span className="grad">software</span>.
          </h1>
          <p className="mk-lede">
            Uniqus Code lets anyone describe what they want, pick the AI they
            trust, and watch their app come to life in a private workspace.
            We&rsquo;re a small, senior team looking for people who want to ship
            that future with us.
          </p>
          <div className="mk-hero-cta">
            <a href="#open-roles" className="btn-primary btn-lg">
              See open roles
            </a>
          </div>
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head">
          <span className="label-eyebrow">Why join</span>
          <h2>A rare seat at a rare moment.</h2>
          <p>
            Coding is being rewritten in real time, and we get to help decide
            what that looks like. Here&rsquo;s why people choose to build it
            with us.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {WHY.map((item) => (
            <article className="mk-card hover" key={item.title}>
              <span className={`mk-ic ${item.iconClass}`}>
                <WhyIcon name={item.icon} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Perks &amp; benefits</span>
          <h2>The basics, done right.</h2>
          <p>
            Nothing flashy — just the things that let good people do their best
            work without friction.
          </p>
        </div>
        <div className="mk-grid cols-3">
          {PERKS.map((perk) => (
            <article className="mk-card" key={perk.title}>
              <h3>{perk.title}</h3>
              <p>{perk.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-page narrow" id="open-roles">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Open roles</span>
          <h2>Where we&rsquo;d love your help.</h2>
          <p>
            Every role here is remote-friendly and full-time. Tell us what
            you&rsquo;ve built and why this matters to you.
          </p>
        </div>
        <div className="job-list">
          {ROLES.map((role) => (
            <div className="job-row" key={role.title}>
              <div className="job-info">
                <h3>{role.title}</h3>
                <div className="job-meta">
                  <span>{role.team}</span>
                  <span>Remote</span>
                  <span>{role.type}</span>
                </div>
              </div>
              <a className="btn-secondary" href={applyHref(role.title)}>
                Apply
              </a>
            </div>
          ))}
        </div>
        <p
          style={{
            marginTop: 28,
            textAlign: "center",
            color: "var(--mk-muted)",
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          Don&rsquo;t see your role? Email{" "}
          <a
            href="mailto:careers@uniqus.com?subject=Open application"
            style={{ color: "var(--brand-magenta)" }}
          >
            careers@uniqus.com
          </a>{" "}
          and tell us how you&rsquo;d help. We read every note.
        </p>
      </section>
    </>
  );
}
