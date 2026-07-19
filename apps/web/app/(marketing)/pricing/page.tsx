import Link from "next/link";
import PricingMaxCard from "./PricingMaxCard";

export const metadata = {
  title: "Pricing — Gate 15",
  description:
    "Start with $3 in trial usage, bring your own AI keys for $8, or choose a prepaid Gate 15 model wallet from $20 per month.",
};

const TIERS = [
  {
    name: "Free",
    amount: "$0",
    per: "no card required",
    desc: "A small, real trial wallet for testing Gate 15 before you commit.",
    cta: { label: "Start free", href: "/login", primary: false },
    features: [
      "$3 one-time build balance",
      "Core agent, plan, preview & sandbox workflow",
      "Auto routing while trial credit remains",
      "Hard stop at $0 — never a surprise charge",
      "Provider keys available after upgrade",
    ],
  },
  {
    name: "BYOK",
    amount: "$8",
    per: "/ month",
    desc: "A paid account for builders who want model charges on their own provider accounts.",
    cta: { label: "Choose BYOK", href: "/settings?plan=byok#billing-settings", primary: false },
    features: [
      "Provider-key access",
      "No Gate 15 model-usage wallet",
      "Anthropic key required for every session",
      "OpenAI, Google & Z.ai keys as needed",
      "Provider spend stays on your accounts",
    ],
  },
  {
    name: "Plus",
    amount: "$20",
    per: "/ month",
    desc: "A predictable monthly wallet for regular building, with immediate correction follow-ups kept separate.",
    badge: "Most popular",
    featured: true,
    cta: { label: "Choose Plus", href: "/settings?plan=plus#billing-settings", primary: true },
    features: [
      "$12 monthly build balance",
      "$2 retry/correction reserve",
      "$14 total monthly model credits",
      "Included Gate 15 model wallet",
      "Optional BYOK provider overrides",
    ],
  },
] as const;

const COMPARE: {
  group: string;
  rows: { label: string; free: string; byok: string; plus: string; max: string }[];
}[] = [
  {
    group: "Model usage",
    rows: [
      { label: "Gate 15 build balance", free: "$3 once", byok: "—", plus: "$12 / mo", max: "$75–$160 / mo" },
      { label: "Retry/correction reserve", free: "—", byok: "—", plus: "$2 / mo", max: "$10–$20 / mo" },
      { label: "Total included model credits", free: "$3 once", byok: "—", plus: "$14 / mo", max: "$85–$180 / mo" },
      { label: "Bring your own provider keys", free: "no", byok: "required", plus: "optional", max: "optional" },
      { label: "Platform-funded work at $0", free: "stops", byok: "not applicable", plus: "BYOK can continue", max: "BYOK can continue" },
    ],
  },
  {
    group: "Platform",
    rows: [
      { label: "Private project microVMs", free: "yes", byok: "yes", plus: "yes", max: "yes" },
      { label: "Plan mode + live preview", free: "yes", byok: "yes", plus: "yes", max: "yes" },
      { label: "Auto model routing", free: "with credit", byok: "Anthropic key", plus: "yes", max: "yes" },
      { label: "Manual Claude, Gemini, GPT & GLM", free: "with credit", byok: "Anthropic + model key", plus: "yes", max: "yes" },
      { label: "GitHub, deploys, skills & checkpoints", free: "yes", byok: "yes", plus: "yes", max: "yes" },
    ],
  },
  {
    group: "Billing",
    rows: [
      { label: "Monthly platform price", free: "$0", byok: "$8", plus: "$20", max: "$100–$200" },
      { label: "Stripe customer portal", free: "—", byok: "yes", plus: "yes", max: "yes" },
      { label: "Choose monthly commitment", free: "—", byok: "fixed", plus: "fixed", max: "$10 steps" },
    ],
  },
];

const FAQ = [
  {
    q: "What does the Free plan include?",
    a: "Free includes a one-time $3 build balance so you can run real tasks and test the workflow without entering a card. When it reaches $0, model-funded work stops until you choose a paid plan.",
  },
  {
    q: "How does BYOK work?",
    a: "BYOK is $8 per month for provider-key access, with no Gate 15 model wallet. Anthropic is required for every session because it powers internal planning, compaction, and Auto. Add OpenAI, Google, or Z.ai for any manual models you use. Gate 15 never falls back to its own keys on this plan.",
  },
  {
    q: "What is the retry/correction reserve?",
    a: "It is a separate allowance for an immediate follow-up when completed work comes back broken and you ask Gate 15 to retry or correct it. It is not another general-purpose wallet, so ordinary building cannot quietly consume that reserve.",
  },
  {
    q: "How is Max calculated?",
    a: "Choose $100–$200 per month in $10 steps. Build balance is 85% of the commitment minus $10; the retry/correction reserve is 10%. That gives $85 total model credits at $100 and $180 at $200, with the exact split shown before checkout.",
  },
  {
    q: "Can Plus and Max also use my provider keys?",
    a: "Yes. On Plus and Max, a configured provider key overrides the Gate 15 wallet for that provider. Leave it blank to use included credits. Keys are encrypted, write-only, and never exposed to the sandbox or agent.",
  },
  {
    q: "Who handles my card and subscription?",
    a: "Stripe hosts checkout and the billing portal. Gate 15 stores the plan and credit-ledger state needed to enforce your wallet, but card details stay with Stripe.",
  },
  {
    q: "What happens to my guest work when I sign up?",
    a: "Your guest projects carry over to the full account automatically. Subscriptions require a full account so purchases, credits, and receipts stay attached to the right person.",
  },
];

function cell(value: string) {
  if (value === "yes") return <span className="yes" aria-label="Included">✓</span>;
  if (value === "no" || value === "—") return <span className="no" aria-label="Not included">—</span>;
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
            A clear edge on <span className="grad">included AI spend</span>.
          </h1>
          <p className="mk-lede">
            Pay for the platform, bring your own model keys, or choose a prepaid wallet.
            Every route is explicit before the agent starts spending.
          </p>
        </div>
      </section>

      <div className="mk-page wide">
        <div className="pricing-grid">
          {TIERS.map((tier) => (
            <article
              className={`price-card${"featured" in tier && tier.featured ? " featured" : ""}`}
              key={tier.name}
            >
              {"badge" in tier && tier.badge && <span className="price-badge">{tier.badge}</span>}
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
                {tier.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
            </article>
          ))}
          <PricingMaxCard />
        </div>
      </div>

      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Compare plans</span>
          <h2>Platform access and model spend, separated.</h2>
        </div>
        <div className="compare-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Free</th>
                <th>BYOK</th>
                <th>Plus</th>
                <th>Max</th>
              </tr>
            </thead>
            {COMPARE.map((section) => (
              <tbody key={section.group}>
                <tr>
                  <th colSpan={5} className="compare-group">{section.group}</th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>{cell(row.free)}</td>
                    <td>{cell(row.byok)}</td>
                    <td>{cell(row.plus)}</td>
                    <td>{cell(row.max)}</td>
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
          <h2>Wallets without the fine print.</h2>
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
