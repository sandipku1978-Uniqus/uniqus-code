/**
 * Curated starter-app catalog â€” the single source of truth shared by the public
 * marketing `/templates` page and the in-app Templates tab (TemplatesView).
 *
 * Every template carries a real first-brief `prompt`: the in-app gallery feeds
 * it straight into `createProjectFromBrief` (creating a real project and opening
 * the workspace), and the marketing CTA stashes it through sign-in so the choice
 * survives the auth round-trip. Keep the prompts concrete and self-contained â€”
 * each should build a working starter the agent can run in the sandbox preview
 * with realistic seeded data (no real secret keys / external services required).
 */

export type Thumb = "t1" | "t2" | "t3" | "t4" | "t5";

export type Art =
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

export interface Template {
  title: string;
  desc: string;
  tags: string[];
  thumb: Thumb;
  art: Art;
  /** First-brief seed prompt â€” what the new project starts building from. */
  prompt: string;
}

export interface TemplateCategory {
  eyebrow: string;
  heading: string;
  blurb: string;
  templates: Template[];
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    eyebrow: "Finance, GRC & audit",
    heading: "Governed tools finance & risk teams actually run on.",
    blurb:
      "Control registers, approval workflows, and evidence trails â€” built in a private, isolated workspace with plan-approval and rewind, so the boring-but-critical internal tooling ships fast without leaving your governance behind.",
    templates: [
      {
        title: "SOX control register",
        desc: "Track key controls, owners, test status, and exceptions with an audit-ready trail.",
        tags: ["Controls", "SOX", "Evidence"],
        thumb: "t1",
        art: "admin",
        prompt:
          "Build a SOX control register: a table of internal controls with columns for control ID, process area, owner, frequency, last test date, test result (pass/fail/overdue), and an evidence note. Add filtering by process and status, an 'add control' form, and a summary bar showing how many controls passed, failed, or are overdue.",
      },
      {
        title: "Expense approval workflow",
        desc: "Submit, route, and approve expenses with policy checks and a clear status trail.",
        tags: ["Approvals", "Policy", "Audit log"],
        thumb: "t2",
        art: "billing",
        prompt:
          "Build an expense approval workflow: employees submit an expense (amount, category, date, receipt note, justification); each gets a status (submitted â†’ approved/rejected) and an approver. Show an approver queue with approve/reject + comment, automatically flag expenses over a configurable limit for extra review, and keep an immutable activity log of who did what and when.",
      },
      {
        title: "Audit evidence log",
        desc: "A searchable register of audit requests, evidence collected, and sign-off status.",
        tags: ["Audit", "Evidence", "Sign-off"],
        thumb: "t4",
        art: "wiki",
        prompt:
          "Build an audit evidence log: a register of audit requests (control reference, requested-by, due date, status) where each request can attach evidence notes/links, be marked 'provided', then 'accepted' by the auditor. Add search, filter by status and owner, an overdue highlight, and a per-request timeline of activity.",
      },
      {
        title: "Budget vs. actuals dashboard",
        desc: "Compare planned vs. actual spend by department with variance highlights.",
        tags: ["Budget", "Variance", "Charts"],
        thumb: "t3",
        art: "dashboard",
        prompt:
          "Build a budget vs. actuals dashboard: enter budget and actual amounts per department per month, then show a table and a bar chart of planned vs actual with the variance and variance % per row, highlight overspend in red, and show a total roll-up across departments with a month filter.",
      },
    ],
  },
  {
    eyebrow: "Apps & internal tools",
    heading: "Tools your team actually uses.",
    blurb:
      "Dashboards, admin panels, and shared knowledge â€” the everyday software that runs a company, scaffolded and ready to shape.",
    templates: [
      {
        title: "Internal admin tool",
        desc: "A CRUD back office with tables, search, and role-gated actions over your own data.",
        tags: ["Next.js", "Auth", "Tables"],
        thumb: "t1",
        art: "admin",
        prompt:
          "Build an internal admin back office: a sidebar with a few resources (Users, Orders, Products), each showing a searchable, sortable, paginated data table with status badges. Add a detail drawer to view a row, an edit form with validation, a 'new record' form, and a delete confirm. Seed realistic sample data, gate destructive actions behind a confirm, and keep a simple activity feed of recent changes.",
      },
      {
        title: "Customer CRM",
        desc: "Track contacts, deals, and notes with a pipeline view and quick activity logging.",
        tags: ["Pipeline", "Supabase", "Notes"],
        thumb: "t2",
        art: "crm",
        prompt:
          "Build a simple CRM: a contacts list (name, company, email, deal value, stage) plus a Kanban pipeline view (Lead â†’ Qualified â†’ Proposal â†’ Won/Lost) where you drag cards between stages. Each contact opens a detail panel with editable fields and a timeline of notes you can add. Seed realistic sample contacts and deals, and show pipeline totals (count and $ value) per stage.",
      },
      {
        title: "Analytics dashboard",
        desc: "Charts, KPI cards, and filters wired to live data â€” ready to point at your numbers.",
        tags: ["Charts", "Filters", "KPIs"],
        thumb: "t3",
        art: "dashboard",
        prompt:
          "Build an analytics dashboard: a row of KPI cards (revenue, active users, conversion, churn) each showing the value, the change vs last period, and a sparkline; a main area chart of a metric over time with a date-range selector; a bar chart broken down by channel; and a recent-activity table. Wire it to realistic seeded time-series data, add a segment filter, and make the charts responsive.",
      },
      {
        title: "Team wiki",
        desc: "A searchable knowledge base with nested docs, markdown editing, and clean navigation.",
        tags: ["Docs", "Search", "Markdown"],
        thumb: "t4",
        art: "wiki",
        prompt:
          "Build a team wiki: a left sidebar tree of nested pages, a reading pane that renders markdown (headings, code blocks, lists, tables), and an in-place editor with live preview. Add full-text search across pages, breadcrumbs, and a 'new page' action, and seed it with a few realistic docs (onboarding, engineering practices, an incident runbook). Persist pages in state so edits stick during the session.",
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
        prompt:
          "Build a polished SaaS landing page: a hero with headline, subcopy, and a primary CTA over a subtle gradient; a logo strip; a 3-up feature section; an alternating feature/benefit band with a product mockup; testimonials; a pricing teaser; an FAQ accordion; and a footer. Write real, specific marketing copy (no lorem ipsum) for a plausible product, make it fully responsive, and keep one tasteful accent color.",
      },
      {
        title: "Waitlist + email capture",
        desc: "A coming-soon page that collects sign-ups, confirms by email, and tracks your list.",
        tags: ["Email", "Forms", "Pre-launch"],
        thumb: "t5",
        art: "waitlist",
        prompt:
          "Build a pre-launch waitlist page: a centered hero explaining the product, an email capture form with inline validation and a success state (\"You're #142 on the list\"), and a referral nudge with a small FAQ. Store sign-ups in state, show a live count of how many have joined, prevent duplicate emails, and make the success state feel shareable. Real copy for a plausible product, fully responsive.",
      },
      {
        title: "Blog / changelog",
        desc: "Write posts in markdown, publish a clean feed, and keep customers up to date on what shipped.",
        tags: ["MDX", "Feed", "RSS"],
        thumb: "t4",
        art: "blog",
        prompt:
          "Build a blog + changelog: an index listing posts (title, date, tag, excerpt); a post page that renders markdown with a clean reading layout and a table of contents; tag filtering; and a separate changelog feed grouped by version with dated entries. Seed several realistic posts and changelog entries, add prev/next navigation, and make typography the centerpiece.",
      },
      {
        title: "Pricing page",
        desc: "Tiered plan cards, a feature comparison table, and an FAQ â€” built to convert.",
        tags: ["Plans", "Compare", "FAQ"],
        thumb: "t3",
        art: "pricing",
        prompt:
          "Build a pricing page: three tiered plan cards (Starter, Pro, Enterprise) with price, a monthly/annual toggle that updates the prices, a highlighted recommended plan, and a feature list per tier; a detailed feature-comparison table below; and an FAQ accordion. Use real, specific feature copy for a plausible product, add a clear CTA per plan, and make it fully responsive.",
      },
    ],
  },
  {
    eyebrow: "Commerce & billing",
    heading: "Take payments without the plumbing.",
    blurb:
      "Stripe-backed flows and storefronts with the hard parts handled â€” checkout, webhooks, and subscriptions wired up from the start.",
    templates: [
      {
        title: "Stripe billing flow",
        desc: "Checkout, customer portal, and webhook handling so plans, upgrades, and invoices just work.",
        tags: ["Stripe", "Webhooks", "Checkout"],
        thumb: "t2",
        art: "billing",
        prompt:
          "Build a SaaS billing UI: a current-plan summary, a plan picker (Free/Pro/Team) with upgrade/downgrade, a payment-method section (card on file, add/replace via a mock card form), an invoices table with status and itemized line items, and usage-this-period meters. Model the data on Stripe but use mock/in-memory data (no real keys), simulate the upgrade flow with optimistic UI, and keep it production-looking and responsive.",
      },
      {
        title: "E-commerce storefront",
        desc: "A product catalog, cart, and checkout with inventory and order management built in.",
        tags: ["Catalog", "Cart", "Orders"],
        thumb: "t3",
        art: "storefront",
        prompt:
          "Build an e-commerce storefront: a product grid with images, price, and category filters; a product detail page with variants (size/color) and add-to-cart; a slide-out cart with quantity controls and a running total; and a mock checkout with order summary and a confirmation screen. Seed a realistic catalog with inventory, persist the cart in state, and make it fully responsive.",
      },
      {
        title: "Subscription dashboard",
        desc: "Let customers manage their plan, payment method, and usage from a self-serve account area.",
        tags: ["Self-serve", "Usage", "Plans"],
        thumb: "t5",
        art: "subscription",
        prompt:
          "Build a self-serve subscription dashboard: a current-plan card with renewal date and price, a usage section with meters against plan limits, a plan-management area to change or cancel (with a clear 'what you'll lose' confirm), a payment method, and a billing-history table. Use realistic seeded data, simulate plan changes with optimistic updates, and surface clear trialing / active / past-due states.",
      },
      {
        title: "Booking / scheduling",
        desc: "Availability slots, calendar booking, and confirmation emails for appointments or rentals.",
        tags: ["Calendar", "Slots", "Reminders"],
        thumb: "t1",
        art: "booking",
        prompt:
          "Build a booking/scheduling app: a week view of available time slots, a service/duration picker, and a booking form (name, email, notes) that reserves a slot and shows a confirmation with an 'add to calendar' summary. Prevent double-booking, gray out taken/past slots, show the host's availability windows, and list upcoming bookings with cancel/reschedule. Seed realistic availability and a few existing bookings.",
      },
    ],
  },
];
