import Link from "next/link";

export const metadata = {
  title: "AI models — Gate 15",
  description:
    "Pick the AI you trust for each step — Claude, GLM, GPT, or Gemini — or stay on Auto and let Gate 15 route planning and building to the best model for the job.",
};

type Icon = "auto" | "claude" | "glm" | "gpt" | "gemini" | "dial" | "search";

function ModelIcon({ name }: { name: Icon }) {
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
    case "auto":
      // Branching router — one input fanning to three outputs.
      return (
        <svg {...p}>
          <path d="M4 12h4M16 6h4M16 18h4" />
          <path d="M8 12c4 0 4-6 8-6M8 12c4 0 4 6 8 6" />
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      );
    case "claude":
      // Compass — careful, considered direction.
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z" />
        </svg>
      );
    case "glm":
      // Bolt in a frame — efficient, high-value coding at a fraction of the cost.
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M13 8l-4 5h3l-1 4 4-5h-3l1-4Z" />
        </svg>
      );
    case "gpt":
      // Stacked layers / steps — multi-step problem solving.
      return (
        <svg {...p}>
          <path d="M12 3l9 5-9 5-9-5 9-5Z" />
          <path d="M3 12l9 5 9-5" />
          <path d="M3 16l9 5 9-5" />
        </svg>
      );
    case "gemini":
      // Sparkle — fast, broad synthesis.
      return (
        <svg {...p}>
          <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
          <path d="M7.5 7.5l3 3M13.5 13.5l3 3M16.5 7.5l-3 3M10.5 13.5l-3 3" />
        </svg>
      );
    case "dial":
      // Slider control — thinking effort.
      return (
        <svg {...p}>
          <path d="M4 7h16M4 12h16M4 17h16" />
          <circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="11" cy="17" r="2.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "search":
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <path d="M16 16l5 5" />
        </svg>
      );
  }
}

const PROVIDERS: {
  icon: Icon;
  iconClass: string;
  provider: string;
  name: string;
  body: string;
  strengths: string[];
}[] = [
  {
    icon: "claude",
    iconClass: "grad",
    provider: "Anthropic",
    name: "Claude (Opus / Sonnet)",
    body: "The careful builder. Reads the whole picture before it moves, lays out a plan, and makes precise, well-reasoned changes across a project.",
    strengths: [
      "Deep planning and careful, surgical edits",
      "Long, focused building sessions that stay on track",
      "Clear explanations of what it changed and why",
    ],
  },
  {
    icon: "glm",
    iconClass: "green",
    provider: "Z.ai — GLM",
    name: "GLM-5.2",
    body: "The value pick. Near-Opus coding quality at a fraction of the cost, with a 1M-token context that swallows whole codebases in one go.",
    strengths: [
      "Near-Opus coding quality for a fraction of the price",
      "1M-token context for large, sprawling projects",
      "Strong, cost-effective everyday building",
    ],
  },
  {
    icon: "gpt",
    iconClass: "purple",
    provider: "OpenAI",
    name: "GPT-5.5 / GPT-5.3 Codex",
    body: "The problem-solver. Strong at writing code, untangling tricky bugs, and pushing through multi-step tasks without losing the thread.",
    strengths: [
      "Complex problem-solving and debugging",
      "Fluent, idiomatic code across languages",
      "Sticks with long, multi-step tasks",
    ],
  },
  {
    icon: "gemini",
    iconClass: "cyan",
    provider: "Google",
    name: "Gemini",
    body: "The fast synthesizer. Built for working through a lot of information at once — great for research-heavy work and quick turnarounds.",
    strengths: [
      "Working through large amounts of context",
      "Research-heavy tasks and broad synthesis",
      "Fast turnarounds when you want momentum",
    ],
  },
];

const EFFORTS: { level: string; tone: string; body: string }[] = [
  {
    level: "Low",
    tone: "Quick passes",
    body: "Snappy answers for small edits, copy tweaks, and questions where you already know roughly what you want.",
  },
  {
    level: "Medium",
    tone: "The default",
    body: "A balanced amount of reasoning that fits most building work — careful enough to get it right, fast enough to keep moving.",
  },
  {
    level: "High",
    tone: "Hard problems",
    body: "More room to think through tricky rebuilds, gnarly bugs, and decisions where one wrong turn costs you an afternoon.",
  },
  {
    level: "X-High / Max",
    tone: "Go all in",
    body: "The deepest rungs, for the models that support them — for when you want the model to spare no reasoning before it acts.",
  },
];

const COMPARE: {
  feature: string;
  claude: string;
  glm: string;
  gpt: string;
  gemini: string;
}[] = [
  {
    feature: "Built-in web search",
    claude: "yes",
    glm: "yes",
    gpt: "yes",
    gemini: "yes",
  },
  {
    feature: "Thinking effort (low → max)",
    claude: "yes",
    glm: "yes",
    gpt: "yes",
    gemini: "yes",
  },
  {
    feature: "Best for",
    claude: "Deep planning & careful changes",
    glm: "Great coding value & huge context",
    gpt: "Complex problems & multi-step code",
    gemini: "Research & fast turnarounds",
  },
  {
    feature: "Works on Auto",
    claude: "yes",
    glm: "no",
    gpt: "no",
    gemini: "yes",
  },
];

function cell(value: string) {
  if (value === "yes")
    return (
      <span className="yes" aria-label="Yes">
        ✓
      </span>
    );
  if (value === "no")
    return (
      <span className="no" aria-label="No">
        —
      </span>
    );
  return value;
}

export default function ModelsPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> AI models
          </span>
          <h1>
            Pick the AI you trust <span className="grad">for each step</span>.
          </h1>
          <p className="mk-lede">
            Gate 15 runs on four frontier model families — Anthropic Claude,
            Z.ai GLM, OpenAI GPT, and Google Gemini. Stay on Auto and let it route
            planning and building to the right model, or choose yourself for any turn.
          </p>
          <div className="mk-hero-cta">
            <Link href="/login" className="btn-primary btn-lg">
              Start building
            </Link>
            <Link href="/docs" className="btn-secondary btn-lg">
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* Auto mode highlight */}
      <section className="mk-page narrow">
        <article className="mk-card hover" style={{ padding: 32 }}>
          <span className="mk-ic grad">
            <ModelIcon name="auto" />
          </span>
          <h3 style={{ fontSize: 22 }}>Auto mode picks the right AI for you</h3>
          <p style={{ fontSize: 15 }}>
            Don&rsquo;t want to think about which model to use? Auto is the default.
            Gate 15 reads what you&rsquo;re asking for and routes it to the model best
            suited to the moment — a careful planner for mapping out a change, a
            strong coder for building it. You can always override per turn or set
            your own default model in Settings, and switch mid-project whenever the
            work changes shape.
          </p>
          <ul className="mk-checks">
            <li>The default for every new project — zero setup</li>
            <li>Routes planning and building to the best-fit model</li>
            <li>Override any turn, or set an account-wide default</li>
          </ul>
        </article>
      </section>

      {/* Four providers */}
      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Four providers, one workspace</span>
          <h2>Four strong models, each great at something.</h2>
          <p>
            They each have a personality. Knowing the differences helps you reach
            for the right one — or trust Auto to do it for you.
          </p>
        </div>
        <div className="mk-grid cols-2">
          {PROVIDERS.map((m) => (
            <article className="mk-card hover" key={m.name}>
              <span className={`mk-ic ${m.iconClass}`}>
                <ModelIcon name={m.icon} />
              </span>
              <span className="mk-card-num">{m.provider}</span>
              <h3>{m.name}</h3>
              <p>{m.body}</p>
              <ul className="mk-checks">
                {m.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* Thinking effort */}
      <section className="mk-page">
        <div className="mk-rows">
          <div className="mk-row">
            <div>
              <span className="mk-ic purple">
                <ModelIcon name="dial" />
              </span>
              <h3>Dial in how hard it thinks</h3>
              <p>
                Thinking effort is a per-turn control over how much the model
                reasons before it answers — a full slider from low up through max,
                scoped to whatever rungs the current model actually supports. Set
                it right in the composer for a single turn, or pick an account-wide
                default in Settings. New projects start on medium, which fits most
                building work. Reach for high (or beyond, up to max on models that
                go that far) when a task is genuinely hard, or low when you just
                want a quick pass.
              </p>
              <ul className="mk-checks">
                <li>Per-turn control, set in the composer&rsquo;s model picker</li>
                <li>Account-wide default in Settings — defaults to medium</li>
                <li>Works across all four providers, each scoped to its own range</li>
              </ul>
            </div>
            <div className="mk-row-art">
              <div className="mk-grid" style={{ gap: 12, width: "100%" }}>
                {EFFORTS.map((e) => (
                  <div
                    key={e.level}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "14px 16px",
                      border: "1px solid var(--mk-line)",
                      borderRadius: "var(--radius-md)",
                      background:
                        "color-mix(in srgb, var(--mk-panel-solid) 70%, transparent)",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <strong style={{ fontSize: 15, color: "var(--mk-text)" }}>
                        {e.level}
                      </strong>
                      <span
                        style={{
                          fontFamily: "var(--font-mono-stack)",
                          fontSize: 10.5,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          color: "var(--mk-dim)",
                        }}
                      >
                        {e.tone}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "var(--mk-muted)",
                      }}
                    >
                      {e.body}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Built-in web search */}
          <div className="mk-row flip">
            <div>
              <span className="mk-ic cyan">
                <ModelIcon name="search" />
              </span>
              <h3>Built-in web search, on every provider</h3>
              <p>
                When the answer depends on something current — a library&rsquo;s
                latest API, a framework that shipped last week, today&rsquo;s docs —
                the model can search the web on its own. It&rsquo;s built in for
                Claude, GLM, GPT, and Gemini alike, so you get up-to-date answers no
                matter which AI you&rsquo;re using. Every search shows up in the
                project history, so you can see exactly what it looked up.
              </p>
              <ul className="mk-checks">
                <li>Available on all four providers</li>
                <li>Used only when the answer needs fresh information</li>
                <li>Each search is logged in your project&rsquo;s history</li>
              </ul>
            </div>
            <div className="mk-row-art">
              <div
                style={{
                  width: "100%",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    border: "1px solid var(--mk-line-strong)",
                    borderRadius: "var(--radius-full)",
                    background:
                      "color-mix(in srgb, var(--mk-bg) 50%, transparent)",
                    color: "var(--mk-muted)",
                    fontSize: 13.5,
                  }}
                >
                  <span style={{ display: "inline-flex", color: "var(--brand-ember)" }}>
                    <ModelIcon name="search" />
                  </span>
                  latest framework release notes
                </div>
                {["Anthropic Claude", "Z.ai GLM", "OpenAI GPT", "Google Gemini"].map((label) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      border: "1px solid var(--mk-line)",
                      borderRadius: "var(--radius-md)",
                      background:
                        "color-mix(in srgb, var(--mk-panel-solid) 70%, transparent)",
                      fontSize: 13,
                      color: "var(--mk-text)",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--mk-green)",
                        flex: "none",
                      }}
                    />
                    {label}
                    <span
                      style={{
                        marginLeft: "auto",
                        fontFamily: "var(--font-mono-stack)",
                        fontSize: 10.5,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        color: "var(--mk-dim)",
                      }}
                    >
                      web search
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="mk-page">
        <div className="mk-section-head center">
          <span className="label-eyebrow">Side by side</span>
          <h2>How the providers compare.</h2>
          <p>
            Every model in the picker is a curated, full-strength choice. We leave
            out the lighter tiers — Haiku, Flash-Lite, mini and nano — so you never
            have to wonder whether you picked one that&rsquo;s too small for the job.
          </p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="compare-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Claude</th>
                <th>GLM</th>
                <th>GPT</th>
                <th>Gemini</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.feature}>
                  <th>{row.feature}</th>
                  <td>{cell(row.claude)}</td>
                  <td>{cell(row.glm)}</td>
                  <td>{cell(row.gpt)}</td>
                  <td>{cell(row.gemini)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mk-lede" style={{ marginTop: 16, fontSize: 14 }}>
          All four are always available to pick yourself, per turn or as your
          account default — Auto currently chooses between Claude and Gemini
          automatically, with GLM and GPT support on the way.
        </p>
      </section>

      {/* Closing note: curated selection */}
      <section className="mk-page narrow">
        <div className="mk-prose">
          <h2>A curated list, not a menu of trade-offs</h2>
          <p>
            New models land constantly, and most of them aren&rsquo;t worth your
            time. Gate 15 keeps a hand-picked, single source of truth for the models
            you can select, shared by the workspace and the router so the choice you
            see is always the choice that runs.
          </p>
          <p>
            We deliberately exclude the low tiers — Haiku, Flash-Lite, and the
            mini and nano variants. They&rsquo;re cheaper, but they cut corners on
            exactly the kind of careful, multi-step building this product is for. The
            models you can pick are the ones we&rsquo;d pick. If you&rsquo;d rather
            not think about it at all, leave it on{" "}
            <Link href="/login">Auto</Link> and let Gate 15 choose for you.
          </p>
        </div>
      </section>
    </>
  );
}
