// Shared, pure-data module for the Gate 15 blog. No JSX here — the index
// (/blog) and the detail page (/blog/[slug]) both read from POSTS so a single
// edit keeps the listing and the article in sync.

export type ContentBlock = {
  type: "p" | "h2" | "ul";
  text?: string;
  items?: string[];
};

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  author: string;
  readingTime: string;
  tag: string;
  thumb: "p1" | "p2" | "p3" | "p4";
  content: ContentBlock[];
};

export const POSTS: Post[] = [
  {
    slug: "from-idea-to-deployed-app",
    title: "From idea to deployed app, without leaving the page",
    excerpt:
      "Describe what you want, watch it build in a live preview, and ship it — all in one tab. Here's how a single sentence becomes a running app.",
    date: "May 28, 2026",
    author: "The Gate 15 team",
    readingTime: "6 min read",
    tag: "Product",
    thumb: "p1",
    content: [
      {
        type: "p",
        text: "Most build tools make you hop between a chat window, an editor, a terminal, a preview, and a deploy dashboard. Each jump is a chance to lose your train of thought. Gate 15 collapses all of that into one page: you type what you want, the agent plans and builds it inside a private workspace, and you watch the result render live a few feet from where you're typing.",
      },
      {
        type: "h2",
        text: "It starts with a sentence",
      },
      {
        type: "p",
        text: "You don't need a spec or a repo to begin. \"Build me a habit tracker with a weekly streak view\" is enough. The agent turns that into a plan, picks the right files to create, and starts writing code in a real machine — not a sandbox toy, but a full Linux environment with a package manager, a dev server, and a network boundary of its own.",
      },
      {
        type: "h2",
        text: "The preview is the source of truth",
      },
      {
        type: "p",
        text: "As soon as the dev server is up, the live preview shows your actual app — the same thing your users would see. You can click around, point at something that looks off, and ask for a change in plain English. There's no \"build, then refresh, then check\" loop; the preview updates as the code does.",
      },
      {
        type: "ul",
        items: [
          "Click an element in the preview to tell the agent exactly what to change.",
          "Every dev server binds to the workspace network so the preview is reachable instantly.",
          "If something breaks, the error is surfaced back to the agent automatically.",
        ],
      },
      {
        type: "h2",
        text: "Shipping is one explicit step",
      },
      {
        type: "p",
        text: "When it's ready, you deploy. Connect GitHub to push your code, or send the project straight to Vercel with one click. Nothing leaves your workspace until you ask it to — deploys and pushes are deliberate actions you trigger, never something that happens quietly in the background.",
      },
      {
        type: "p",
        text: "The whole arc — idea, plan, build, preview, ship — happens without ever switching apps. That's the point: keep the human in flow, and let the machine handle the context-switching.",
      },
    ],
  },
  {
    slug: "built-in-web-search-across-providers",
    title: "Built-in web search across Claude, GLM, GPT, and Gemini",
    excerpt:
      "Your coding agent can look things up while it works — current docs, API shapes, package versions — using each provider's own server-side search.",
    date: "May 14, 2026",
    author: "The Gate 15 team",
    readingTime: "5 min read",
    tag: "Engineering",
    thumb: "p2",
    content: [
      {
        type: "p",
        text: "Models have a training cutoff, but the web doesn't stop. A library ships a breaking change, an API renames a field, a framework deprecates a pattern — and an agent working from memory will confidently get it wrong. So we wired built-in web search into all four providers, using each one's own server-side search rather than a bolted-on scraper.",
      },
      {
        type: "p",
        text: "Credential mode matters: capped Claude search can use Gate 15 credit, while GLM, GPT, and Gemini search requires your key for that provider. Their APIs do not expose a hard per-request search cap, so Gate 15 does not put those tools on the shared wallet.",
      },
      {
        type: "h2",
        text: "One capability, four implementations",
      },
      {
        type: "p",
        text: "Each provider exposes search differently, so we meet them where they are instead of forcing a lowest-common-denominator shim:",
      },
      {
        type: "ul",
        items: [
          "Claude uses its server-side web_search tool directly.",
          "GLM searches through its own built-in web_search tool.",
          "GPT searches through the Responses API's built-in web_search tool.",
          "Gemini 3.x uses Google Search grounding alongside its function calling.",
        ],
      },
      {
        type: "h2",
        text: "Search you can see",
      },
      {
        type: "p",
        text: "When the agent searches, it shows up as its own activity in the project timeline — not a hidden side effect. You can see what it looked up and when, which matters when you're trying to understand why it chose a particular approach. The loop never runs these searches itself; they're handled server-side by the provider and surfaced back as a result.",
      },
      {
        type: "h2",
        text: "Why it matters for code",
      },
      {
        type: "p",
        text: "The newest models often know more than their training data suggests, but \"often\" isn't good enough when a single wrong import breaks a build. Letting the agent verify the current shape of an API before it writes against it turns guesswork into something closer to how a careful engineer works: check the docs, then write the code.",
      },
    ],
  },
  {
    slug: "a-private-machine-for-every-project",
    title: "A private machine for every project",
    excerpt:
      "Every project runs in its own isolated virtual machine — not a shared container, not a browser tab. Here's why that isolation is the foundation.",
    date: "April 30, 2026",
    author: "The Gate 15 team",
    readingTime: "6 min read",
    tag: "Infrastructure",
    thumb: "p3",
    content: [
      {
        type: "p",
        text: "When an AI agent can run arbitrary commands, install packages, and start servers, where it runs matters as much as what it does. We give every project its own virtual machine — a real, isolated environment with its own filesystem and network boundary — rather than sharing a container or running things in your browser.",
      },
      {
        type: "h2",
        text: "Isolation by default",
      },
      {
        type: "p",
        text: "A runaway script, a risky command, or a dependency that misbehaves in one project can't reach another. Mutable state is scoped to the project that owns it. There's no shared blast radius, because there's nothing shared to begin with.",
      },
      {
        type: "h2",
        text: "Fast to start, cheap to keep",
      },
      {
        type: "p",
        text: "A dedicated machine per project sounds expensive, so we spent real effort on cold-start latency: boot fixes that skip a doomed network lease, a read-only base image shared across projects, and an optional pre-booted snapshot that makes new projects start in well under a second. Idle workspaces pause and resume exactly where you left off.",
      },
      {
        type: "ul",
        items: [
          "Own filesystem — your code and dependencies stay walled off.",
          "Own network boundary — nothing leaks between projects.",
          "Pause when idle, resume in place — no lost state, no wasted compute.",
        ],
      },
      {
        type: "h2",
        text: "The trust foundation",
      },
      {
        type: "p",
        text: "Real isolation is what makes everything else safe to offer. Letting an agent run commands freely is only reasonable when those commands live inside a boundary that can't touch your other work, your secrets, or anyone else's project. The private VM is the floor the rest of the product stands on.",
      },
    ],
  },
  {
    slug: "plan-before-you-build",
    title: "Plan before you build: how plan mode works",
    excerpt:
      "Before touching a single file, the agent can lay out exactly what it intends to do — so you approve the approach, not just react to the result.",
    date: "April 16, 2026",
    author: "The Gate 15 team",
    readingTime: "5 min read",
    tag: "Product",
    thumb: "p4",
    content: [
      {
        type: "p",
        text: "The fastest way to waste an agent's time is to let it sprint in the wrong direction. Plan mode adds a deliberate pause: before writing code, the agent describes what it's going to do — which files it will create or change, what the structure looks like, and what tradeoffs it's making — and waits for you to agree.",
      },
      {
        type: "h2",
        text: "Read the plan, then commit",
      },
      {
        type: "p",
        text: "A good plan is short enough to skim and specific enough to trust. You see the shape of the work before it happens, so course corrections cost a sentence instead of a rebuild. Disagree with the data model? Say so now, while changing it is free.",
      },
      {
        type: "h2",
        text: "Guardrails on risky moves",
      },
      {
        type: "p",
        text: "Plan mode pairs with a broader principle: anything destructive or hard to undo is flagged for your approval rather than pushed through quietly. The agent surfaces the risky step, explains it, and waits. You stay in control of the moments that actually matter.",
      },
      {
        type: "ul",
        items: [
          "See the intended changes before any file is touched.",
          "Redirect with a single comment instead of a full redo.",
          "Risky or irreversible actions pause for an explicit yes.",
        ],
      },
      {
        type: "h2",
        text: "Faster, because it's slower at the right moment",
      },
      {
        type: "p",
        text: "Spending thirty seconds reading a plan routinely saves the minutes — and the frustration — of unwinding work that went the wrong way. The pause isn't friction; it's the cheapest place to catch a misunderstanding.",
      },
    ],
  },
  {
    slug: "why-we-let-you-pick-the-ai",
    title: "Why we let you pick the AI for each step",
    excerpt:
      "Claude, GLM, GPT, or Gemini — and an Auto mode that routes for you. No single model is best at everything, so we don't pretend otherwise.",
    date: "April 2, 2026",
    author: "The Gate 15 team",
    readingTime: "6 min read",
    tag: "Engineering",
    thumb: "p1",
    content: [
      {
        type: "p",
        text: "Plenty of tools pick one model and hide it from you. We took the opposite bet: let people use the AI they trust, switch when it makes sense, and default to a smart router when they'd rather not think about it. No single model wins every task, and the landscape changes monthly — so flexibility isn't a feature, it's a hedge against lock-in.",
      },
      {
        type: "h2",
        text: "Four providers, one workspace",
      },
      {
        type: "p",
        text: "Gate 15 runs on Claude, GLM, GPT, and Gemini, with a curated list of the models actually worth using for serious coding. You can set a default for your account or override it per turn from the composer — switch models mid-conversation without losing context.",
      },
      {
        type: "h2",
        text: "Auto mode, when you'd rather not choose",
      },
      {
        type: "p",
        text: "Most of the time you don't want to think about model selection — you want a good answer. Auto mode routes each turn to a strong default so you get reliable results without managing it yourself. When you do have a preference, it's one click away.",
      },
      {
        type: "h2",
        text: "Bring your own keys",
      },
      {
        type: "p",
        text: "On paid plans you can add your own Anthropic, OpenAI, Google, or Z.ai API keys. Usage then bills through those providers directly, and your keys stay encrypted at rest — never displayed back to you in full, never exposed to the agent.",
      },
      {
        type: "ul",
        items: [
          "Pick Claude, GLM, GPT, or Gemini per turn or per account.",
          "Auto mode routes to a strong default when you don't want to decide.",
          "Tune reasoning effort — from low up to max — to trade speed for depth.",
          "Add your own provider keys; they stay encrypted and out of the model's view.",
        ],
      },
      {
        type: "p",
        text: "The goal is simple: you should never feel stuck with a model that's wrong for the job. The best AI for a task is the one you get to choose.",
      },
    ],
  },
];

export function getPost(slug: string): Post | undefined {
  return POSTS.find((post) => post.slug === slug);
}
