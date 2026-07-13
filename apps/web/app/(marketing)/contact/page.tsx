import Link from "next/link";
import ContactForm from "@/components/ContactForm";

export const metadata = {
  title: "Contact — Gate 15",
  description:
    "Talk to the Gate 15 team about sales, support, security, or partnerships. Send us a message and we'll get back to you.",
};

type MethodIcon = "sales" | "support" | "security" | "careers";

function MethodIcon({ name }: { name: MethodIcon }) {
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
    case "sales":
      return (
        <svg {...p}>
          <path d="M3 12a9 9 0 1 1 4.5 7.8L3 21l1.2-4.5A8.96 8.96 0 0 1 3 12Z" />
          <path d="M8.5 10.5h7M8.5 14h4.5" />
        </svg>
      );
    case "support":
      return (
        <svg {...p}>
          <path d="M5 18v-6a7 7 0 0 1 14 0v6" />
          <path d="M19 19a2 2 0 0 1-2 2h-1M3 13.5h2.5v5H4a1 1 0 0 1-1-1v-4Zm15.5 0H21v4a1 1 0 0 1-1 1h-1.5v-5Z" />
        </svg>
      );
    case "security":
      return (
        <svg {...p}>
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "careers":
      return (
        <svg {...p}>
          <rect x="3" y="7.5" width="18" height="12" rx="2" />
          <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 12.5h18" />
        </svg>
      );
  }
}

const METHODS: {
  icon: MethodIcon;
  iconClass: string;
  title: string;
  body: string;
  cta: { label: string; href: string; external?: boolean };
}[] = [
  {
    icon: "sales",
    iconClass: "grad",
    title: "Sales & Enterprise",
    body: "Rolling out Gate 15 to a team or organization? We'll walk you through SSO, dedicated capacity, security reviews, and pricing.",
    cta: { label: "See Enterprise", href: "/enterprise" },
  },
  {
    icon: "support",
    iconClass: "cyan",
    title: "Product support",
    body: "Stuck on a build, a deploy, or a workspace? Start with the help center — and reach a human when you need one.",
    cta: { label: "Visit Support", href: "/support" },
  },
  {
    icon: "security",
    iconClass: "green",
    title: "Security & disclosure",
    body: "Found a vulnerability or need a DPA? Email our security team directly with the details and we'll respond quickly.",
    cta: { label: "security@gate15.dev", href: "mailto:security@gate15.dev" },
  },
  {
    icon: "careers",
    iconClass: "purple",
    title: "Join the team",
    body: "We're building the AI workspace we wish we had. If that sounds like your kind of problem, we'd love to hear from you.",
    cta: { label: "View open roles", href: "/careers" },
  },
];

export default function ContactPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Contact
          </span>
          <h1>
            Let&rsquo;s <span className="grad">talk</span>.
          </h1>
          <p className="mk-lede">
            Whether you&rsquo;re sizing up Gate 15 for a team, stuck on a build,
            or just have a question — send us a note and a real person will get
            back to you.
          </p>
        </div>
      </section>

      <section className="mk-page">
        <div className="contact-grid">
          <div>
            <div className="mk-section-head">
              <span className="label-eyebrow">Send a message</span>
              <h2>Tell us what you need.</h2>
              <p>
                Fill in the form and we&rsquo;ll route it to the right people.
                Pick a topic so it lands in the right inbox.
              </p>
            </div>
            <ContactForm />
          </div>

          <div className="contact-info">
            {METHODS.map((m) => (
              <article className="contact-method" key={m.title}>
                <span className={`mk-ic ${m.iconClass}`}>
                  <MethodIcon name={m.icon} />
                </span>
                <strong>{m.title}</strong>
                <p>{m.body}</p>
                <p style={{ marginTop: 12 }}>
                  {m.cta.href.startsWith("mailto:") ? (
                    <a href={m.cta.href}>{m.cta.label}</a>
                  ) : (
                    <Link
                      href={m.cta.href}
                      style={{ color: "var(--accent-text)" }}
                    >
                      {m.cta.label} &rarr;
                    </Link>
                  )}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
