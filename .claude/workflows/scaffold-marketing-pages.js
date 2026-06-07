export const meta = {
  name: 'scaffold-marketing-pages',
  description: 'Build the remaining Uniqus Code marketing/resource pages from a shared design spec',
  phases: [
    { title: 'Write', detail: 'one agent writes each page from the shared spec + golden examples' },
    { title: 'Review', detail: 'each page is reviewed against the checklist and fixed in place' },
  ],
}

// ── Shared spec handed to every writer agent ──────────────────────────────
const SHARED = `
You are building ONE page (or a small set of tightly-coupled files) for the
marketing site of **Uniqus Code** — an AI workspace where people describe what
they want, pick the AI they trust (Claude / GPT / Gemini), and watch their app
come to life in a private, isolated cloud workspace with a live preview.

## Ground truth — READ THESE FIRST (they define the exact patterns + CSS vocabulary)
Use the Read tool on all of these before writing anything:
1. apps/web/app/(marketing)/pricing/page.tsx        ← golden example (cards, table, FAQ)
2. apps/web/app/(marketing)/security/page.tsx       ← golden example (hero, stats, icon cards, prose)
3. apps/web/app/(marketing)/layout.tsx              ← the shared chrome (see rules below)
4. The CSS: Grep apps/web/app/globals.css for "Marketing sub-pages" and Read the
   ~600 lines that follow — that block defines every .mk-* / pricing / template /
   changelog / post / faq / contact / status / job class you may use.
Also skim apps/web/app/page.tsx and CLAUDE.md for product facts + voice.

## HARD RULES (violating these breaks the page)
- The page is a **default-export React Server Component** (no "use client") UNLESS it
  needs interactivity. Export a \`metadata\` object: { title: "… — Uniqus Code", description: "…" }.
- The \`(marketing)\` layout ALREADY renders the top nav, a bottom "Ready to build?"
  CTA, and the footer around your page. So your file must return ONLY the page
  content — a React fragment <>…</> starting with a <section className="mk-hero"> and
  then content in <section className="mk-page"> (or "mk-page narrow"/"mk-page wide")
  containers. DO NOT add a nav, a footer, or a final global CTA band.
- Use ONLY classes that exist in globals.css (the .mk-* sub-page vocabulary +
  landing primitives like section.band/.section-head/.label-eyebrow/.feature-grid +
  buttons .btn-primary/.btn-secondary/.btn-ghost/.btn-lg). If you need a one-off
  tweak, use an inline style={{…}} with CSS variables (var(--mk-text), var(--mk-muted),
  var(--mk-line), var(--brand-magenta), var(--brand-gradient), --radius-*, etc.).
  **NEVER edit globals.css or any other shared file. Only create your own new file(s).**
- Theme-aware: never hardcode hex colors in JSX/inline styles — always reference the
  --mk-* / --brand-* tokens so light mode keeps working. (Gradient *classes* already
  bake in brand colors; that's fine.)
- Internal links: import Link from "next/link" and use <Link href="/…">. External
  links: <a href="https://…" target="_blank" rel="noopener noreferrer">. mailto: is fine.
- Icons: inline <svg> (stroke="currentColor", width/height 18-22, aria-hidden). Match the
  PracticeIcon style in security/page.tsx. No icon libraries.
- Voice: warm, plain-English, confident but not hypey. Match the landing copy. Use
  real product facts (3 model providers, Auto routing, plan mode, private VM per project,
  live preview, built-in web search, GitHub sync, Vercel deploy, encrypted secrets,
  checkpoints/rewind, skills & design packs). Do NOT invent fake customer logos, funding
  numbers, employee counts, or compliance certifications.
- Reuse the eyebrow pattern: <span className="mk-eyebrow"><span className="dot" /> Label</span>.
- Hero heading may wrap one phrase in <span className="grad">…</span> for the gradient.
- Quality bar: this must look as finished and polished as the two golden pages — generous
  sections, real copy (no lorem ipsum, no "coming soon"/stub text), responsive by virtue of
  the provided classes. Aim for 4-6 well-built sections.

## CSS vocabulary cheat-sheet (all defined; confirm details by reading globals.css)
- Hero: .mk-hero (+ .left), .mk-hero-inner, .mk-eyebrow (.dot), h1 + .grad, .mk-lede, .mk-hero-cta
- Section heads: .mk-section-head (+ .center) with <span className="label-eyebrow"> + h2 + p
- Containers: .mk-page (+ .narrow / .wide)
- Grids/cards: .mk-grid (.cols-2/.cols-3/.cols-4), .mk-card (+ .hover), .mk-ic (+ .purple/.cyan/.green/.amber/.grad), .mk-card-num, .mk-checks > li
- Feature rows: .mk-rows > .mk-row (+ .flip), .mk-row-art
- Stats: .stat-grid > .stat > (.num + .lbl)
- Logo cloud: .logo-cloud-label + .logo-cloud > span  (use REAL integrations only: GitHub, Vercel, Stripe, Supabase, Anthropic, OpenAI, Google)
- Pricing: .pricing-grid > .price-card (+ .featured), .price-badge, .price-name, .price-amount(.amt/.per), .price-desc, .price-cta, .price-features > li(.off); .compare-table
- Templates: .template-grid > .template-card > .template-thumb(.t1..t5 + svg) + .template-body(h3/p/.template-tags > .mk-tag)
- Changelog: .changelog > .changelog-entry > .changelog-date(.ver) + .changelog-body(h3 + ul>li with <span className="change-tag new|improved|fixed">)
- Blog: .post-grid > .post-card(+ .feature) > .post-thumb(.p1..p4) + .post-body(.post-meta + h3 + p)
- Prose: .mk-prose (h2/h3/p/ul/li/a/blockquote/code/hr). Article: .mk-article-head + .mk-article-body
- Doc shell: .mk-doc-shell > (aside.mk-toc with .label-micro + <a> anchors) + content
- FAQ: .faq-list > details.faq-item > (summary + p.faq-a)   ← native, no JS
- Contact: .contact-grid, .contact-form, .field(label + input/textarea/select, .req), .field-row, .contact-info > .contact-method, .form-note, .form-ok
- Status: .status-banner(.big-dot, strong, span), .status-list > .status-row > (.status-name > .status-dot.ok/.degraded/.down) + .status-state.ok; .uptime-bar > i(.d)
- Careers: .job-list > .job-row > (.job-info > h3 + .job-meta > span) + apply <a>
- Back link: <Link className="mk-back">

Return a SHORT summary (file paths written + the sections you built). Do not paste file contents.
`

const PAGES = [
  {
    key: 'models',
    files: ['apps/web/app/(marketing)/models/page.tsx'],
    brief: `PAGE: /models — "AI models".
Write apps/web/app/(marketing)/models/page.tsx.
Sections:
- Hero: eyebrow "AI models", a bold headline about picking the right AI for each step, lede explaining Auto mode + three providers.
- "Auto mode" highlight (a .mk-card or short band): Uniqus picks the best AI for planning vs building automatically; you can always override.
- The three providers as .mk-rows > .mk-row (alternating, use .flip on the 2nd) OR a .mk-grid cols-3 of rich .mk-card: Anthropic Claude (deep planning, careful changes, long focused sessions), OpenAI GPT-5.x / Codex (complex problem-solving, writing code, multi-step tasks), Google Gemini (working through lots of information, research-heavy, fast turnarounds). Each card lists strengths via .mk-checks.
- "Thinking effort" section: low / medium / high per-turn reasoning control (default medium), set in the composer or as an account default.
- "Built-in web search" section: all three providers can search the web when the answer depends on up-to-date info.
- A .compare-table comparing the providers across: Web search (yes/yes/yes), Thinking control, Best for. (Keep it accurate to the cheat-sheet facts.)
Note: low tiers (Haiku, Flash-Lite, mini/nano) are intentionally excluded from the curated list — mention curated selection.`,
  },
  {
    key: 'workspaces',
    files: ['apps/web/app/(marketing)/workspaces/page.tsx'],
    brief: `PAGE: /workspaces — "Workspaces".
Write apps/web/app/(marketing)/workspaces/page.tsx.
Theme: each project runs on its own private virtual machine — a real, secure computer in the cloud, not a shared browser tab.
Sections:
- Hero: eyebrow "Workspaces", headline like "Real machines for real builds.", lede.
- .stat-grid (e.g., "1 VM / project", "Sub-second reopen", "Live preview", "Saved between sessions") — keep numbers honest/illustrative, no false precision.
- .mk-rows alternating feature rows: (1) A space of its own (isolation), (2) A real computer not a toy (install software, run real databases, start your app), (3) See it live (live preview next to your code; the agent screenshots its own work), (4) Pick up where you left off (reopen in seconds, exactly as you left it), (5) Experiment safely (checkpoints + rewind). Use simple inline-SVG art inside .mk-row-art (a little terminal/window/db illustration).
- A short "What's inside a workspace" .mk-grid cols-3 of .mk-card: Files & editor, Chat + plan mode, Logs & terminal output, Secrets (encrypted), Skills & design packs, Deploy & GitHub.
Cross-link /security and /models where natural.`,
  },
  {
    key: 'templates',
    files: ['apps/web/app/(marketing)/templates/page.tsx'],
    brief: `PAGE: /templates — "Templates".
Write apps/web/app/(marketing)/templates/page.tsx.
Goal: a gallery of starting points. Do NOT build fake/non-functional filter chips — instead organize templates into 3 labeled CATEGORY sections, each a .mk-section-head + a .template-grid.
Categories + example templates (give each a title, 1-line desc, 2-3 .mk-tag tags, a .template-thumb with a t1..t5 class + a relevant inline svg, and a "Use this template" <Link href="/login"> at the bottom of the body):
- "Apps & internal tools": Internal admin tool, Customer CRM, Analytics dashboard, Team wiki.
- "Marketing & growth": Landing page, Waitlist + email capture, Blog / changelog, Pricing page.
- "Commerce & billing": Stripe billing flow, E-commerce storefront, Subscription dashboard, Booking / scheduling.
Open with a short hero (eyebrow "Templates", headline "Start from a proven template", lede). Total ~12 cards. Each card uses .template-card.`,
  },
  {
    key: 'changelog',
    files: ['apps/web/app/(marketing)/changelog/page.tsx'],
    brief: `PAGE: /changelog — "Changelog".
Write apps/web/app/(marketing)/changelog/page.tsx.
Hero: eyebrow "Changelog", headline "What's new", lede ("Product updates, big and small.").
Then a .changelog with ~6 entries, most-recent first, dates in 2026 (e.g., "Jun 2026" down to "Jan 2026") with a .ver pill (v1.6 … v1.1). Base entries on REAL shipped features:
- Multi-provider models + per-turn model picker (New)
- Thinking effort low/medium/high (New)
- Built-in web search across Claude, GPT, and Gemini (New)
- Faster new-project cold start / golden base snapshot (Improved)
- Error boundaries + mobile-responsive workspace (Improved)
- Preview annotator + iframe error bridge (New)
- Landing-page composer with voice input (New)
- Security hardening pass (Fixed/Improved)
- Checkpoints search + day grouping (Improved)
Use <span className="change-tag new|improved|fixed"> on each bullet. Mix 2-4 bullets per entry.`,
  },
  {
    key: 'enterprise',
    files: ['apps/web/app/(marketing)/enterprise/page.tsx'],
    brief: `PAGE: /enterprise — "Enterprise" (take layout cues from a clean B2B "close deals faster" page, but on the Uniqus dark brand).
Write apps/web/app/(marketing)/enterprise/page.tsx.
Sections:
- Hero (the .mk-hero grid background suits this well): eyebrow "Enterprise", a bold outcome headline (e.g., "Ship internal tools at the speed of your roadmap."), lede about giving teams a governed, secure way to build with AI. .mk-hero-cta with a primary <Link href="/contact">Book a demo</Link> and a secondary <Link href="/security">Review our security</Link>.
- A logo cloud of REAL integrations (NOT fake customers): .logo-cloud-label "Works with the stack you already use" + .logo-cloud spans: GitHub, Vercel, Stripe, Supabase, Anthropic, OpenAI, Google.
- Value cards .mk-grid cols-3 of .mk-card with .mk-ic icons: SSO / SAML & SCIM, Audit logs & role-based access, Dedicated VM capacity & SLAs, DPA & security review, Volume billing & invoicing, Dedicated success manager.
- "Built for how enterprises build" .mk-rows: governance & approvals (plan-before-change), isolation per project, bring-your-own model keys, deploy to your targets.
- .stat-grid (illustrative, no false precision).
- An in-page demo CTA (.mk-cta-band is owned by the layout — instead use a .mk-card or a simple centered block) directing to /contact. (Do NOT duplicate the layout's bottom CTA.)`,
  },
  {
    key: 'about',
    files: ['apps/web/app/(marketing)/about/page.tsx'],
    brief: `PAGE: /about — "About".
Write apps/web/app/(marketing)/about/page.tsx.
Sections:
- Hero: eyebrow "About", a mission headline (e.g., "Software should be buildable by anyone with an idea."), lede.
- A .mk-page narrow .mk-prose mission/story (2-4 short paragraphs): why Uniqus Code exists — make building real software accessible, keep the AI transparent (shows its plan, cites its work), give people a real machine per project. Mention it's part of Uniqus Consultech. Keep it about mission/principles; do NOT invent funding, headcount, or founding-date specifics.
- Values: .mk-grid cols-3 of .mk-card with .mk-ic: "Show your work" (transparency), "Trust by default" (security/guardrails), "Build in the open" (you stay in control), "Craft over hype", "Your choice of AI", "Ship, don't stall". (~6 values.)
- A .stat-grid of illustrative, non-misleading figures (e.g., "3 AI providers", "1 VM per project", "Plan-first by default") — reuse facts, avoid invented metrics.
- Cross-link /careers ("We're hiring") and /contact.`,
  },
  {
    key: 'careers',
    files: ['apps/web/app/(marketing)/careers/page.tsx'],
    brief: `PAGE: /careers — "Careers".
Write apps/web/app/(marketing)/careers/page.tsx.
Sections:
- Hero: eyebrow "Careers", headline "Help build the future of software.", lede.
- "Why join" .mk-grid cols-3 of .mk-card (with .mk-ic): work on a frontier AI product, small senior team, real ownership, remote-friendly, etc.
- Perks .mk-grid cols-2/cols-3 of .mk-card: remote-first, competitive equity, learning budget, top-tier hardware, flexible time off, latest AI tools. (Keep generic/honest.)
- Open roles: a .job-list with ~5 .job-row entries (e.g., Founding Frontend Engineer, Backend / Infrastructure Engineer, Product Designer, Developer Advocate, Member of Technical Staff). Each .job-info has h3 + .job-meta spans (Team · Remote · Full-time) and an "Apply" link on the right: <a href="mailto:careers@uniqus.com?subject=Application: ROLE">Apply</a>.
- A closing line: "Don't see your role? Email careers@uniqus.com" — honest, since there's no ATS backend.`,
  },
  {
    key: 'blog',
    files: [
      'apps/web/app/(marketing)/blog/posts.ts',
      'apps/web/app/(marketing)/blog/page.tsx',
      'apps/web/app/(marketing)/blog/[slug]/page.tsx',
    ],
    brief: `PAGE SET: /blog index + /blog/[slug] detail + a shared posts data module. Create ALL THREE files.

1) apps/web/app/(marketing)/blog/posts.ts — a pure-data TS module (NO JSX). Export:
   - type ContentBlock = { type: "p" | "h2" | "ul"; text?: string; items?: string[] }
   - type Post = { slug; title; excerpt; date; author; readingTime; tag; thumb (one of "p1".."p4"); content: ContentBlock[] }
   - export const POSTS: Post[] = [ ~5 posts ]
   - export function getPost(slug: string): Post | undefined
   Topics (real product themes, write genuine 4-6 block bodies each — no lorem):
   "Why we let you pick the AI for each step", "Plan before you build: how plan mode works",
   "A private machine for every project", "Built-in web search across Claude, GPT, and Gemini",
   "From idea to deployed app, without leaving the page". Dates in 2026, descending.

2) apps/web/app/(marketing)/blog/page.tsx — server component, exports metadata.
   Hero (eyebrow "Blog", headline "Notes from the workshop", lede). Then a .post-grid where the
   first post is .post-card.feature (full width) and the rest are normal cards. Each card is a
   <Link href={"/blog/"+post.slug}> wrapping .post-thumb (use post.thumb class) + .post-body
   (.post-meta with tag + date + readingTime, h3 title, p excerpt). Map over POSTS.

3) apps/web/app/(marketing)/blog/[slug]/page.tsx — server component.
   - export async function generateStaticParams() returning POSTS.map(p => ({ slug: p.slug })).
   - export async function generateMetadata({ params }) — note params is a Promise in Next 15, so
     'const { slug } = await params;'. Return title/description from the post (fallback if missing).
   - Default export: 'const { slug } = await params; const post = getPost(slug); if (!post) notFound();'
     (import { notFound } from "next/navigation"). Render a <Link className="mk-back" href="/blog">← All posts</Link>,
     a .mk-article-head (eyebrow with tag, h1 title, a meta line with author · date · readingTime), then
     .mk-article-body > .mk-prose rendering content blocks: type "h2" -> <h2>, "p" -> <p>, "ul" -> <ul> of <li>.
   Verify the params Promise typing compiles (Next 15 App Router).`,
  },
  {
    key: 'contact',
    files: [
      'apps/web/app/(marketing)/contact/page.tsx',
      'apps/web/components/ContactForm.tsx',
    ],
    brief: `PAGE: /contact — "Contact". Create TWO files.
metadata lives on the page (server component); the interactive form is a separate client component.

1) apps/web/components/ContactForm.tsx — "use client". A controlled form with fields: name (required),
   email (required), company (optional), topic (<select>: Sales, Support, Security, Partnerships, Other),
   message (required textarea). Use .contact-form/.field/.field-row/.req classes. On submit
   (e.preventDefault), build a mailto: URL to hello@uniqus.com with a subject from the topic and a body
   composed of the fields, then set window.location.href to it; flip a local "sent" state that replaces the
   form with a .form-ok message ("Thanks — your email client should open with your message ready to send. If
   it didn't, email us at hello@uniqus.com."). Include a .form-note under the button. This is honest, working
   behavior (no fake backend). Submit button is .btn-primary.

2) apps/web/app/(marketing)/contact/page.tsx — server component, exports metadata. Hero (eyebrow "Contact",
   headline "Let's talk.", lede). Then .mk-page with a .contact-grid: left column = <ContactForm />; right
   column = .contact-info with ~4 .contact-method cards: Sales (link to /enterprise), Support (link to
   /support), Security (mailto:security@uniqus.com), Careers (link to /careers). Import ContactForm from
   "@/components/ContactForm".`,
  },
  {
    key: 'support',
    files: ['apps/web/app/(marketing)/support/page.tsx'],
    brief: `PAGE: /support — "Support" / help center.
Write apps/web/app/(marketing)/support/page.tsx (server component).
Sections:
- Hero: eyebrow "Support", headline "How can we help?", lede. In .mk-hero-cta put primary <Link href="/guide">Read the guide</Link> and secondary <Link href="/contact">Contact us</Link>. (Do NOT build a fake search box.)
- A .mk-page with a .mk-doc-shell: left aside.mk-toc (label-micro "Topics" + anchor <a href="#getting-started"> etc.); right = several <section id="…"> blocks, each a .mk-section-head + a .faq-list of 3-4 details.faq-item with genuine answers grounded in the product/guide.
  Topic sections + ids: Getting started (#getting-started), Account & billing (#billing), Workspaces & previews (#workspaces), Models & thinking (#models), Shipping & deploys (#shipping), Troubleshooting (#troubleshoot).
- Make answers real and useful (draw from CLAUDE.md + the guide page content: plan mode, run/preview binds 0.0.0.0, model picker, secrets, checkpoints/rewind, GitHub/deploy, guest vs signed-in).
- Close with a "Still stuck?" .mk-card linking to /contact.`,
  },
  {
    key: 'community',
    files: ['apps/web/app/(marketing)/community/page.tsx'],
    brief: `PAGE: /community — "Community".
Write apps/web/app/(marketing)/community/page.tsx.
Sections:
- Hero: eyebrow "Community", headline "Build together.", lede.
- "Where to find us" .mk-grid cols-3 of .mk-card.hover with .mk-ic icons, each linking out (use placeholder external URLs with target=_blank, or internal where it makes sense): Community forum / Discord, GitHub discussions, X / Twitter, Templates & showcase (-> /templates), Office hours, Changelog (-> /changelog). Each card: icon + h3 + p + a small link/label.
- "Ways to get involved" section: .mk-grid cols-2 or .mk-checks (share what you built, help others, request features, contribute templates).
- A short "Showcase" band encouraging users to share projects, linking to /templates.
Keep it warm and inviting.`,
  },
  {
    key: 'status',
    files: ['apps/web/app/(marketing)/status/page.tsx'],
    brief: `PAGE: /status — "System status".
Write apps/web/app/(marketing)/status/page.tsx (server component).
This is a static status overview (there is no live monitoring backend), so present it as a clean current
snapshot with a "Last checked" line — do NOT claim real-time/continuous monitoring.
Sections:
- A compact header (can be a smaller .mk-hero or just an .mk-page with .mk-section-head): eyebrow "Status", headline "System status".
- A .status-banner (operational variant): .big-dot + strong "All systems operational" + span "Last checked: June 2026".
- A .status-list with .status-row entries for each component, each with .status-name (.status-dot.ok + name) and .status-state.ok "Operational": Web app, Orchestrator API, Workspaces (VMs), Model routing — Anthropic, Model routing — OpenAI, Model routing — Google, Live previews, Deploys, GitHub sync.
- An "Uptime (last 90 days)" .mk-grid cols-3 of small .mk-card, each with a component name + a .uptime-bar of ~30 <i> bars (mostly up, a couple .d to look real) + a "99.9% uptime" label.
- A small note + a "Subscribe to updates" <a href="mailto:status@uniqus.com">.
- A line linking to /support for help.`,
  },
]

phase('Write')
const results = await pipeline(
  PAGES,
  (page) => agent(`${SHARED}\n\n## YOUR TASK\n${page.brief}`, {
    label: `write:${page.key}`,
    phase: 'Write',
  }),
  // Review + fix in place, independently per page (no barrier).
  (writeSummary, page) => agent(
    `You are reviewing the newly-written page file(s) for the Uniqus Code marketing site and FIXING any problems in place (use Edit/Write).
Files to review: ${page.files.join(', ')}

The writer reported:
${writeSummary}

Check each file against this CHECKLIST and fix violations directly (do not redesign working pages):
1. Valid TSX that will pass 'tsc --noEmit' and 'next build' (Next 15 App Router). Watch for: unkeyed list items,
   unescaped ' or " in JSX text (use &rsquo;/&ldquo; or braces), fragments-in-arrays needing keys, importing Link when used,
   and in dynamic routes the Next 15 rule that params is a Promise (await it).
2. Server component with an exported \`metadata\` object — UNLESS the file legitimately needs "use client" (e.g. ContactForm).
   A file that exports metadata must NOT have "use client".
3. Returns ONLY page content (a fragment) — NO <nav>, NO <footer>, NO global bottom CTA band (the layout owns those).
4. Uses ONLY classes that exist in apps/web/app/globals.css. Grep globals.css to confirm any .mk-*/pricing/template/etc.
   class actually exists; if a class is missing, switch to an existing one or an inline style with var(--…) tokens.
   It must NOT have edited globals.css or any shared file.
5. No hardcoded hex colors in JSX/inline styles — only var(--mk-*)/var(--brand-*) tokens (gradient classes are ok).
6. No placeholder/stub/"coming soon"/lorem text; copy is real, specific, and on-brand. No invented customer logos,
   funding, headcount, or compliance certs.
7. Internal links use next/link <Link>; external links use <a target="_blank" rel="noopener noreferrer">.

Run a quick mental compile. Report what you fixed. Return STRICTLY a JSON object via the StructuredOutput tool.`,
    {
      label: `review:${page.key}`,
      phase: 'Review',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'ok', 'fixes', 'notes'],
        properties: {
          key: { type: 'string' },
          ok: { type: 'boolean', description: 'true if the file(s) now satisfy the whole checklist' },
          fixes: { type: 'array', items: { type: 'string' }, description: 'concrete fixes applied' },
          notes: { type: 'string', description: 'anything the human should double-check' },
        },
      },
    },
  ),
)

log(`Scaffolded ${results.filter(Boolean).length}/${PAGES.length} page sets.`)
return results.filter(Boolean)
