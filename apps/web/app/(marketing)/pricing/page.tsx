import Link from "next/link";

export const metadata = {
  title: "Pricing — Gate 15",
  description:
    "Simple, transparent pricing. Start free for solo projects, scale with Team plans, and talk to us for Enterprise.",
};

const TIERS = [
  {
    name: "Free",
    amount: "$0",
    per: "forever",
    desc: "For solo builders exploring ideas and shipping side projects.",
    cta: { label: "Start building", href: "/login", primary: true },
    features: [
      { label: "Unlimited public-idea projects", on: true },
      { label: "Auto model routing (Claude, GPT, Gemini, GLM)", on: true },
      { label: "Bring your own model API keys", on: true },
      { label: "One private workspace at a time", on: true },
      { label: "Live preview + plan mode", on: true },
      { label: "Built-in web search", on: true },
      { label: "Community support", on: true },
    ],
  },
  {
    name: "Team",
    amount: "$20",
    per: "/ seat / month",
    desc: "For teams building real products together, with room to scale.",
    badge: "Most popular",
    featured: true,
    cta: { label: "Start a Team trial", href: "/login", primary: true },
    features: [
      { label: "Everything in Free", on: true },
      { label: "Concurrent private workspaces", on: true },
      { label: "GitHub sync + one-click deploys", on: true },
      { label: "Skills, secrets & design packs", on: true },
      { label: "Checkpoints & rewind history", on: true },
      { label: "Priority email support", on: true },
    ],
  },
  {
    name: "Enterprise",
    amount: "Custom",
    per: "talk to us",
    desc: "For organizations with security, scale, and compliance needs.",
    cta: { label: "Contact sales", href: "/enterprise", primary: false },
    features: [
      { label: "Everything in Team", on: true },
      { label: "SSO today via WorkOS — SAML & SCIM on our roadmap", on: true },
      { label: "Dedicated VM capacity & SLAs", on: true },
      { label: "Org audit views & roles — rolling out, early access", on: true },
      { label: "DPA, security review & invoicing", on: true },
      { label: "Dedicated success manager", on: true },
    ],
  },
];

const COMPARE: { group: string; rows: { label: string; free: string; team: string; ent: string }[] }[] = [
  {
    group: "Building",
    rows: [
      { label: "Private workspaces", free: "1", team: "Unlimited", ent: "Unlimited" },
      { label: "Auto model routing", free: "yes", team: "yes", ent: "yes" },
      { label: "Bring your own API keys", free: "yes", team: "yes", ent: "yes" },
      { label: "Built-in web search", free: "yes", team: "yes", ent: "yes" },
    ],
  },
  {
    group: "Ship & recover",
    rows: [
      { label: "GitHub sync", free: "no", team: "yes", ent: "yes" },
      { label: "One-click deploys", free: "no", team: "yes", ent: "yes" },
      { label: "Checkpoints & rewind", free: "Last 24h", team: "Full history", ent: "Full history" },
    ],
  },
  {
    group: "Team & security",
    rows: [
      { label: "SSO (WorkOS)", free: "no", team: "no", ent: "yes" },
      { label: "SAML / SCIM", free: "no", team: "no", ent: "Roadmap" },
      { label: "Org audit views & roles", free: "no", team: "no", ent: "Early access" },
      { label: "Audit trail (secrets, connectors, checkpoints)", free: "yes", team: "yes", ent: "yes" },
      { label: "Encrypted secrets", free: "yes", team: "yes", ent: "yes" },
      { label: "Support", free: "Community", team: "Priority email", ent: "Dedicated" },
    ],
  },
];

const FAQ = [
  {
    q: "Is the Free plan really free?",
    a: "Yes. Solo builders can plan, build, preview, and iterate on projects without a credit card. Auto mode routes to the best AI for each step at no cost on Free.",
  },
  {
    q: "How does per-seat billing work on Team?",
    a: "You pay $20 per active member per month. Add or remove seats anytime — we prorate the difference on your next invoice.",
  },
  {
    q: "Can I use my own model API keys?",
    a: "Yes, on every plan — Free included, as long as you've signed up for a full account (guest sessions can't yet). Add your own Anthropic, OpenAI, or Google key in Settings and usage for that provider bills to your account directly — keys stay encrypted at rest and are never shown back in full. Z.ai (GLM) keys aren't supported yet. Need per-org keys for a whole team? Reach out through the Enterprise page.",
  },
  {
    q: "What happens to my guest work if I sign up?",
    a: "Guest accounts need no Google or email sign-in — you get a one-time recovery code to restore your projects on another device. When you create a full account, your guest projects carry over automatically so nothing is lost.",
  },
  {
    q: "Do you offer discounts for startups or education?",
    a: "Yes — reach out through the Enterprise page and tell us about your team. We work with early-stage startups, nonprofits, and educators.",
  },
];

function cell(value: string) {
  if (value === "yes") return <span className="yes" aria-label="Included">✓</span>;
  if (value === "no") return <span className="no" aria-label="Not included">—</span>;
  return value;
}

export default function PricingPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Pricing
          </span>
          <h1>
            Pricing that scales <span className="grad">with your ideas</span>.
          </h1>
          <p className="mk-lede">
            Start free, invite your team when you&rsquo;re ready, and only talk to
            sales when you need enterprise controls. No surprises.
          </p>
        </div>
      </section>

      <div className="mk-page wide">
        <div className="pricing-grid">
          {TIERS.map((tier) => (
            <div
              className={`price-card${tier.featured ? " featured" : ""}`}
              key={tier.name}
            >
              {tier.badge && <span className="price-badge">{tier.badge}</span>}
              <div className="price-name">{tier.name}</div>
              <div className="price-amount">
                <span className="amt">{tier.amount}</span>
                <span className="per">{tier.per}</span>
              </div>
              <p className="price-desc">{tier.desc}</p>
              <div className="price-cta">
                <Link
                  href={tier.cta.href}
                  className={tier.cta.primary ? "btn-primary" : "btn-secondary"}
                >
                  {tier.cta.label}
                </Link>
              </div>
              <ul className="price-features">
                {tier.features.map((f) => (
                  <li key={f.label} className={f.on ? "" : "off"}>
                    {f.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Compare plans</span>
          <h2>Every detail, side by side.</h2>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="compare-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Free</th>
                <th>Team</th>
                <th>Enterprise</th>
              </tr>
            </thead>
            {COMPARE.map((section) => (
              <tbody key={section.group}>
                <tr>
                  <th
                    colSpan={4}
                    style={{
                      color: "var(--mk-dim)",
                      fontFamily: "var(--font-mono-stack)",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      paddingTop: 24,
                    }}
                  >
                    {section.group}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>{cell(row.free)}</td>
                    <td>{cell(row.team)}</td>
                    <td>{cell(row.ent)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <section className="mk-page narrow">
        <div className="mk-section-head center">
          <span className="label-eyebrow">FAQ</span>
          <h2>Questions, answered.</h2>
        </div>
        <div className="faq-list">
          {FAQ.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p className="faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
