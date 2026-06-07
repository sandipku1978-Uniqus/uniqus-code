import Link from "next/link";

export const metadata = {
  title: "Templates — Uniqus Code",
  description:
    "Start from a proven template. Open any starting point in its own private workspace, then describe what to change and watch the AI build it live.",
};

type Thumb = "t1" | "t2" | "t3" | "t4" | "t5";
type Art =
  | "admin"
  | "crm"
  | "dashboard"
  | "wiki"
  | "landing"
  | "waitlist"
  | "blog"
  | "pricing"
  | "billing"
  | "storefront"
  | "subscription"
  | "booking";

function TemplateArt({ name }: { name: Art }) {
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "admin":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 4v16" />
        </svg>
      );
    case "crm":
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 7.5a3 3 0 0 1 0 5.8M20.5 19a4.8 4.8 0 0 0-3.2-4.5" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...p}>
          <path d="M4 19V11M9 19V6M14 19v-5M19 19V9" />
          <path d="M3 21h18" />
        </svg>
      );
    case "wiki":
      return (
        <svg {...p}>
          <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H12v18H5.5A1.5 1.5 0 0 1 4 19.5Z" />
          <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H12v18h6.5A1.5 1.5 0 0 0 20 19.5Z" />
        </svg>
      );
    case "landing":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9h10M7 13h6M7 16.5h4" />
        </svg>
      );
    case "waitlist":
      return (
        <svg {...p}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="M3.5 7l8.5 6 8.5-6" />
        </svg>
      );
    case "blog":
      return (
        <svg {...p}>
          <path d="M5 3h11l3 3v15H5Z" />
          <path d="M15 3v3.5h3.5M8 11h8M8 14.5h8M8 18h5" />
        </svg>
      );
    case "pricing":
      return (
        <svg {...p}>
          <rect x="3.5" y="6" width="7" height="13" rx="1.5" />
          <rect x="13.5" y="3" width="7" height="16" rx="1.5" />
          <path d="M3 21h18" />
        </svg>
      );
    case "billing":
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18M7 14.5h4" />
        </svg>
      );
    case "storefront":
      return (
        <svg {...p}>
          <path d="M4 9V7l1.5-3h13L20 7v2a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0Z" />
          <path d="M5 11.5V20h14v-8.5M10 20v-5h4v5" />
        </svg>
      );
    case "subscription":
      return (
        <svg {...p}>
          <path d="M4 11a8 8 0 0 1 13.7-5.3L20 8M20 4v4h-4" />
          <path d="M20 13a8 8 0 0 1-13.7 5.3L4 16M4 20v-4h4" />
        </svg>
      );
    case "booking":
      return (
        <svg {...p}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" />
          <path d="M9 14.5l2 2 4-4" />
        </svg>
      );
  }
}

type Template = {
  title: string;
  desc: string;
  tags: string[];
  thumb: Thumb;
  art: Art;
};

const CATEGORIES: {
  eyebrow: string;
  heading: string;
  blurb: string;
  templates: Template[];
}[] = [
  {
    eyebrow: "Apps & internal tools",
    heading: "Tools your team actually uses.",
    blurb:
      "Dashboards, admin panels, and shared knowledge — the everyday software that runs a company, scaffolded and ready to shape.",
    templates: [
      {
        title: "Internal admin tool",
        desc: "A CRUD back office with tables, search, and role-gated actions over your own data.",
        tags: ["Next.js", "Auth", "Tables"],
        thumb: "t1",
        art: "admin",
      },
      {
        title: "Customer CRM",
        desc: "Track contacts, deals, and notes with a pipeline view and quick activity logging.",
        tags: ["Pipeline", "Supabase", "Notes"],
        thumb: "t2",
        art: "crm",
      },
      {
        title: "Analytics dashboard",
        desc: "Charts, KPI cards, and filters wired to live data — ready to point at your numbers.",
        tags: ["Charts", "Filters", "KPIs"],
        thumb: "t3",
        art: "dashboard",
      },
      {
        title: "Team wiki",
        desc: "A searchable knowledge base with nested docs, markdown editing, and clean navigation.",
        tags: ["Docs", "Search", "Markdown"],
        thumb: "t4",
        art: "wiki",
      },
    ],
  },
  {
    eyebrow: "Marketing & growth",
    heading: "Pages that turn visitors into users.",
    blurb:
      "Launch-ready sites and capture flows. Describe your product and the AI fills in the copy, layout, and structure in your voice.",
    templates: [
      {
        title: "Landing page",
        desc: "A polished one-pager with a hero, feature sections, social proof, and a clear call to action.",
        tags: ["Hero", "Sections", "CTA"],
        thumb: "t1",
        art: "landing",
      },
      {
        title: "Waitlist + email capture",
        desc: "A coming-soon page that collects sign-ups, confirms by email, and tracks your list.",
        tags: ["Email", "Forms", "Pre-launch"],
        thumb: "t5",
        art: "waitlist",
      },
      {
        title: "Blog / changelog",
        desc: "Write posts in markdown, publish a clean feed, and keep customers up to date on what shipped.",
        tags: ["MDX", "Feed", "RSS"],
        thumb: "t4",
        art: "blog",
      },
      {
        title: "Pricing page",
        desc: "Tiered plan cards, a feature comparison table, and an FAQ — built to convert.",
        tags: ["Plans", "Compare", "FAQ"],
        thumb: "t3",
        art: "pricing",
      },
    ],
  },
  {
    eyebrow: "Commerce & billing",
    heading: "Take payments without the plumbing.",
    blurb:
      "Stripe-backed flows and storefronts with the hard parts handled — checkout, webhooks, and subscriptions wired up from the start.",
    templates: [
      {
        title: "Stripe billing flow",
        desc: "Checkout, customer portal, and webhook handling so plans, upgrades, and invoices just work.",
        tags: ["Stripe", "Webhooks", "Checkout"],
        thumb: "t2",
        art: "billing",
      },
      {
        title: "E-commerce storefront",
        desc: "A product catalog, cart, and checkout with inventory and order management built in.",
        tags: ["Catalog", "Cart", "Orders"],
        thumb: "t3",
        art: "storefront",
      },
      {
        title: "Subscription dashboard",
        desc: "Let customers manage their plan, payment method, and usage from a self-serve account area.",
        tags: ["Self-serve", "Usage", "Plans"],
        thumb: "t5",
        art: "subscription",
      },
      {
        title: "Booking / scheduling",
        desc: "Availability slots, calendar booking, and confirmation emails for appointments or rentals.",
        tags: ["Calendar", "Slots", "Reminders"],
        thumb: "t1",
        art: "booking",
      },
    ],
  },
];

export default function TemplatesPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Templates
          </span>
          <h1>
            Start from a <span className="grad">proven template</span>.
          </h1>
          <p className="mk-lede">
            Pick a starting point and open it in its own private workspace. Then
            describe what to change — the AI you trust rebuilds it live, so you
            skip the blank page and go straight to making it yours.
          </p>
          <div className="mk-hero-cta">
            <Link href="/login" className="btn-primary btn-lg">
              Start from a template
            </Link>
            <Link href="/guide" className="btn-secondary btn-lg">
              How it works
            </Link>
          </div>
        </div>
      </section>

      {CATEGORIES.map((category) => (
        <section className="mk-page wide" key={category.eyebrow}>
          <div className="mk-section-head">
            <span className="label-eyebrow">{category.eyebrow}</span>
            <h2>{category.heading}</h2>
            <p>{category.blurb}</p>
          </div>
          <div className="template-grid">
            {category.templates.map((t) => (
              <article className="template-card" key={t.title}>
                <div className={`template-thumb ${t.thumb}`}>
                  <TemplateArt name={t.art} />
                </div>
                <div className="template-body">
                  <h3>{t.title}</h3>
                  <p>{t.desc}</p>
                  <div className="template-tags">
                    {t.tags.map((tag) => (
                      <span className="mk-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <Link
                    href="/login"
                    className="btn-ghost"
                    style={{ marginTop: 16, alignSelf: "flex-start" }}
                  >
                    Use this template →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="mk-page narrow">
        <div className="mk-prose">
          <h2>Templates are a head start, not a cage</h2>
          <p>
            Every template opens as a real project in its own isolated VM — the
            same private workspace you&rsquo;d get from scratch, just with the
            boring scaffolding done. From there it&rsquo;s yours: ask for a new
            screen, swap the data model, change the look, or wire in a service.
            The agent plans the change, you watch it build in the live preview,
            and you can rewind any step that goes sideways.
          </p>
          <p>
            Don&rsquo;t see the one you want?{" "}
            <Link href="/login">Just describe it</Link> — Uniqus Code can build
            an app from a blank prompt every bit as well as from a starting
            point.
          </p>
        </div>
      </section>
    </>
  );
}
