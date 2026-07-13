import ChangelogNav, { type ChangelogNavEntry } from "@/components/ChangelogNav";

type Tag = "new" | "improved" | "fixed";

export const metadata = {
  title: "Changelog - Uniqus Code",
  description:
    "Product updates, big and small. Follow every substantive Uniqus Code change from the first browser workspace through the latest pre-launch build.",
};

interface Entry {
  id: string;
  date: string;
  ver: string;
  title: string;
  changes: { tag: Tag; commit: string; text: string }[];
}

const COMMIT_URL = "https://github.com/sandipku1978-Uniqus/uniqus-code/commit/";

/**
 * Complete substantive history through d329b29. Minor versions mark product
 * generations; patch versions collect the work that completed or hardened
 * that generation. Pure diagnostics (5e17bb2 and de59091) are excluded.
 */
const ENTRIES: Entry[] = [
  {
    id: "v0-1-0",
    date: "Apr 26, 2026",
    ver: "v0.1.0",
    title: "The first working foundation",
    changes: [
      {
        tag: "new",
        commit: "827d09a",
        text: "Created the initial Uniqus Code monorepo and the first working browser workspace, agent, API, and project runtime.",
      },
      {
        tag: "fixed",
        commit: "cc23bea",
        text: "Moved the Tailwind build toolchain into production dependencies so Vercel could build the web app reliably.",
      },
      {
        tag: "fixed",
        commit: "2af7780",
        text: "Made the orchestrator start the server entrypoint on Railway and honor the platform-provided port.",
      },
    ],
  },
  {
    id: "v0-1-1",
    date: "Apr 26, 2026",
    ver: "v0.1.1",
    title: "Import, preview, and direct control",
    changes: [
      {
        tag: "new",
        commit: "91da677",
        text: "Added production preview proxying plus ZIP upload and GitHub clone imports, with imported projects persisted for later sessions.",
      },
      {
        tag: "new",
        commit: "6ddb4d6",
        text: "Added reliable Stop, editable files with autosave, streamed tool work, collapsible completed turns, one-click Run, and storage sync feedback.",
      },
    ],
  },
  {
    id: "v0-1-2",
    date: "Apr 26, 2026",
    ver: "v0.1.2",
    title: "Making the early workspace dependable",
    changes: [
      {
        tag: "fixed",
        commit: "bcd0330",
        text: "Stopped an infinite React render loop that could freeze the editor when opening a file.",
      },
      {
        tag: "new",
        commit: "66cd57d",
        text: "Turned Run into a true one-click action, added explicit save state on tabs, and made preview tabs closable.",
      },
      {
        tag: "fixed",
        commit: "049b8bd",
        text: "Prevented failed preview-server spawns from crashing the orchestrator and tightened preview-tab and Monaco behavior.",
      },
      {
        tag: "fixed",
        commit: "8cf227d",
        text: "Made Stop reliable across provider abort shapes and cleared occupied ports before starting a preview server.",
      },
      {
        tag: "fixed",
        commit: "45c57ab",
        text: "Automatically reinstalled project dependencies after Railway redeploys instead of leaving Run with missing binaries.",
      },
      {
        tag: "fixed",
        commit: "9d701bc",
        text: "Added Git and port-management utilities to the Railway image so imports and server recovery work in production.",
      },
      {
        tag: "fixed",
        commit: "41c44f1",
        text: "Switched those Railway packages to the correct Nix runtime mechanism so they are actually present after deploy.",
      },
    ],
  },
  {
    id: "v0-1-3",
    date: "May 3, 2026",
    ver: "v0.1.3",
    title: "Security and session recovery",
    changes: [
      {
        tag: "improved",
        commit: "e2df401",
        text: "Closed cross-origin, path-containment, and import-safety gaps while improving autosave, disconnect, Stop, and preview-server recovery.",
      },
      {
        tag: "fixed",
        commit: "cba0e70",
        text: "Pinned preview routing with a secure cookie so client-side navigation and hot reload survive path changes.",
      },
      {
        tag: "fixed",
        commit: "6a1f5f5",
        text: "Repaired malformed tool histories after interrupted turns so affected project chats recover automatically.",
      },
    ],
  },
  {
    id: "v0-1-4",
    date: "May 4, 2026",
    ver: "v0.1.4",
    title: "GitHub and Vercel, end to end",
    changes: [
      {
        tag: "new",
        commit: "920857c",
        text: "Added GitHub OAuth repo selection and one-click Vercel deployment with encrypted tokens and live deployment status.",
      },
      {
        tag: "fixed",
        commit: "2956c89",
        text: "Forced the native GitHub repository picker to render legibly in the dark interface.",
      },
      {
        tag: "fixed",
        commit: "2afff43",
        text: "Removed a duplicate certificate package that was breaking Railway image builds.",
      },
    ],
  },
  {
    id: "v0-1-5",
    date: "May 4, 2026",
    ver: "v0.1.5",
    title: "A workspace that survives real projects",
    changes: [
      {
        tag: "new",
        commit: "0fe4a95",
        text: "Added long-session compaction, safer history replay, Python and Go support, structured questions, @file context, uploads, project management, quick open, and durable run/deploy state.",
      },
    ],
  },
  {
    id: "v0-2-0",
    date: "May 10, 2026",
    ver: "v0.2.0",
    title: "Every project gets its own machine",
    changes: [
      {
        tag: "new",
        commit: "42bf1a9",
        text: "Introduced the Firecracker fleet, isolated project machines, encrypted secrets, connectors, checkpoints, skills, and the Phase 2 storage substrate.",
      },
      {
        tag: "fixed",
        commit: "0969993",
        text: "Made the rootfs builder resolve an available supported Firecracker kernel automatically.",
      },
      {
        tag: "fixed",
        commit: "9842cdf",
        text: "Mounted proc, sys, dev, and DNS configuration into the rootfs build chroot so packages and services configure correctly.",
      },
      {
        tag: "improved",
        commit: "14da6d0",
        text: "Added a complete bare-metal Hetzner bring-up checklist for operating the new sandbox fleet.",
      },
    ],
  },
  {
    id: "v0-2-1",
    date: "May 10, 2026",
    ver: "v0.2.1",
    title: "Hardening isolated project machines",
    changes: [
      {
        tag: "fixed",
        commit: "63a1647",
        text: "Routed orchestrator-to-guest RPC over the Firecracker TAP network instead of an unreachable address.",
      },
      {
        tag: "fixed",
        commit: "0a6f055",
        text: "Moved guest network configuration into the in-VM agent, removing a fragile dependency on kernel IP autoconfiguration.",
      },
      {
        tag: "fixed",
        commit: "1fe7b32",
        text: "Raised the VM boot deadline to match real OpenRC cold-start behavior.",
      },
      {
        tag: "fixed",
        commit: "6e2814d",
        text: "Prevented idle pausing during active turns and fixed storage-key, checkpoint, race, and signal-listener bugs.",
      },
      {
        tag: "fixed",
        commit: "df687ff",
        text: "Allowed PUT and PATCH through CORS and made screenshot capture dial the VM rather than localhost.",
      },
      {
        tag: "improved",
        commit: "9622b1f",
        text: "Kept a VM warm while its preview iframe is actively in use.",
      },
    ],
  },
  {
    id: "v0-2-2",
    date: "May 12, 2026",
    ver: "v0.2.2",
    title: "A stronger sandbox agent and multi-session chat",
    changes: [
      {
        tag: "new",
        commit: "d67de4e",
        text: "Shipped the Rust sandbox agent, multiple chat sessions per project, environment-scoped secrets, and a broad round of runtime hardening.",
      },
    ],
  },
  {
    id: "v0-2-3",
    date: "May 13, 2026",
    ver: "v0.2.3",
    title: "Build first, sign up later",
    changes: [
      {
        tag: "new",
        commit: "af1f66a",
        text: "Added free guest and education accounts with recovery codes, so building can start without Google or email sign-in.",
      },
      {
        tag: "fixed",
        commit: "6e914bd",
        text: "Made sign-out clear the domain-scoped WorkOS session cookie correctly.",
      },
      {
        tag: "fixed",
        commit: "b30fb0e",
        text: "Corrected guest-cookie scope so the web app can see the session created by the orchestrator.",
      },
      {
        tag: "fixed",
        commit: "193cb5f",
        text: "Exempted guest API routes from middleware redirects to WorkOS sign-in.",
      },
      {
        tag: "fixed",
        commit: "077a282",
        text: "Made one-click Run install missing VM dependencies before starting the app.",
      },
    ],
  },
  {
    id: "v0-2-4",
    date: "May 24, 2026",
    ver: "v0.2.4",
    title: "A workspace that feels considered",
    changes: [
      {
        tag: "new",
        commit: "d3f6ff5",
        text: "Renamed Codex to Uniqus and added image viewing, drag-and-drop uploads, @file autocomplete, VM sync fixes, and a wide workspace UX overhaul.",
      },
      {
        tag: "improved",
        commit: "08aac95",
        text: "Added Seti-style icons, visible chat history, styled preview errors, zoom controls, screenshot limits, and live file-tree updates.",
      },
    ],
  },
  {
    id: "v0-2-5",
    date: "May 28, 2026",
    ver: "v0.2.5",
    title: "A cleaner product and clearer operations",
    changes: [
      {
        tag: "improved",
        commit: "b435968",
        text: "Defined missing design tokens, unified modal styling, and cleaned up the product type scale.",
      },
      {
        tag: "improved",
        commit: "42882e4",
        text: "Documented branch, Vercel, Hetzner, and sandbox deployment responsibilities for contributors.",
      },
      {
        tag: "fixed",
        commit: "0a71d27",
        text: "Made the new-project card full width and the entire project list card clickable.",
      },
    ],
  },
  {
    id: "v0-2-6",
    date: "May 29, 2026",
    ver: "v0.2.6",
    title: "Planning, preferences, and provider controls",
    changes: [
      {
        tag: "new",
        commit: "96442f1",
        text: "Added VM-aware dependency installs, explicit web-search guidance, plan-mode defaults, an Enter Plan Mode tool, Guide and Settings pages, and a redesigned dashboard hero.",
      },
      {
        tag: "new",
        commit: "fa7896c",
        text: "Expanded the dashboard hero, made the dashboard mobile responsive, and made linking imported repos opt-in.",
      },
      {
        tag: "new",
        commit: "8422ec6",
        text: "Added light and dark appearance, density controls, account-wide custom prompts, and default skills.",
      },
      {
        tag: "fixed",
        commit: "6694ac1",
        text: "Corrected reasoning and web-search parameters against provider documentation, added thinking controls, and upgraded the Anthropic SDK.",
      },
      {
        tag: "fixed",
        commit: "d533bfe",
        text: "Moved OpenAI reasoning-plus-tools traffic to the Responses API and stopped Gemini thought signatures from leaking into Anthropic requests.",
      },
    ],
  },
  {
    id: "v0-2-7",
    date: "May 29, 2026",
    ver: "v0.2.7",
    title: "The agent can read the live web",
    changes: [
      {
        tag: "new",
        commit: "301efa8",
        text: "Added built-in web search across providers, streaming plan mode, faster VM reopen, token fixes, and a broad UX and motion pass.",
      },
      {
        tag: "fixed",
        commit: "e6e1e68",
        text: "Kept the model flyout on-screen, animated editor tabs, and made deploys reinstall dependencies when lockfiles change.",
      },
      {
        tag: "new",
        commit: "f57775e",
        text: "Portaled the model picker, fixed chat replay, added Git-repo awareness, a live token counter, and dashboard usage widgets.",
      },
    ],
  },
  {
    id: "v0-2-8",
    date: "Jun 1, 2026",
    ver: "v0.2.8",
    title: "Faster starts and safer failures",
    changes: [
      {
        tag: "improved",
        commit: "2c08a47",
        text: "Cut new-project cold start from about 18 seconds with boot fixes and an optional golden base snapshot.",
      },
      {
        tag: "new",
        commit: "48cdd31",
        text: "Added web error boundaries, a mobile-responsive workspace, and operational notes for Hetzner deployment.",
      },
      {
        tag: "new",
        commit: "9a569b5",
        text: "Added the preview annotator, provider tests, usage accounting, security documentation, and broader error containment.",
      },
      {
        tag: "new",
        commit: "a97b15c",
        text: "Added a marketing-site project composer with voice input and preserved the idea through sign-in.",
      },
      {
        tag: "improved",
        commit: "cf018fc",
        text: "Completed a security-hardening and UX-audit pass covering exposure risks, shared accessible UI primitives, and pre-push verification.",
      },
    ],
  },
  {
    id: "v0-3-0",
    date: "Jun 7, 2026",
    ver: "v0.3.0",
    title: "Bring your data, bring your design",
    changes: [
      {
        tag: "new",
        commit: "5e0dec2",
        text: "Added Supabase OAuth and database provisioning, Design Systems, a Databases workspace, and the first full marketing site.",
      },
    ],
  },
  {
    id: "v0-3-1",
    date: "Jun 7, 2026",
    ver: "v0.3.1",
    title: "Design systems become a real workflow",
    changes: [
      {
        tag: "improved",
        commit: "c04eaa3",
        text: "Restyled the Databases and Design Systems tabs to match the main application.",
      },
      {
        tag: "improved",
        commit: "2dd2182",
        text: "Reworked Design Systems around an empty-state brief, repository picker, and live preview.",
      },
      {
        tag: "new",
        commit: "ed22bc3",
        text: "Made design-system creation agent-driven with source analysis, findings review, Figma input, and multimodal context.",
      },
      {
        tag: "new",
        commit: "c16adf4",
        text: "Added a full-width collapsible design editor, live activity stream, component catalog, and logo support.",
      },
      {
        tag: "fixed",
        commit: "9d3f77c",
        text: "Raised analysis output limits so large design-system findings no longer truncate into invalid JSON.",
      },
      {
        tag: "fixed",
        commit: "e478175",
        text: "Stopped the lightweight project-naming model from accidentally answering the user's full brief.",
      },
    ],
  },
  {
    id: "v0-3-2",
    date: "Jun 10, 2026",
    ver: "v0.3.2",
    title: "Bring your keys, take your code",
    changes: [
      {
        tag: "new",
        commit: "1c63d7f",
        text: "Added bring-your-own provider keys, first-run onboarding, project export, revocable preview sharing, embeds, and clearer marketing and compliance documentation.",
      },
    ],
  },
  {
    id: "v0-3-3",
    date: "Jun 11, 2026",
    ver: "v0.3.3",
    title: "A deeper product and agent audit",
    changes: [
      {
        tag: "new",
        commit: "0796e25",
        text: "Added a design-excellence agent prompt, redesigned the dashboard, and fixed VM secrets and editor behavior.",
      },
      {
        tag: "improved",
        commit: "6729cc4",
        text: "Remediated roughly 46 security and correctness findings and added the Skills library tab.",
      },
      {
        tag: "improved",
        commit: "54cf2a1",
        text: "Overhauled Skills and Databases, strengthened composition-first design guidance, and fixed mobile workspace behavior.",
      },
      {
        tag: "fixed",
        commit: "24bed27",
        text: "Fixed VM-to-host file pulling so files created by commands are not lost before synchronization.",
      },
      {
        tag: "improved",
        commit: "29d9a76",
        text: "Taught the design agent to prefer restrained, refined output over one-shot maximalism.",
      },
    ],
  },
  {
    id: "v0-3-4",
    date: "Jun 16, 2026",
    ver: "v0.3.4",
    title: "Built for shared work",
    changes: [
      {
        tag: "new",
        commit: "a5fe7a0",
        text: "Added project collaboration, roles, comments, knowledge, tasks, templates, and an agent tool that can inspect and drive the running preview.",
      },
      {
        tag: "fixed",
        commit: "0c70ee1",
        text: "Fixed a clipped project-card icon and an unreadable Design Systems dropdown.",
      },
    ],
  },
  {
    id: "v0-3-5",
    date: "Jun 17, 2026",
    ver: "v0.3.5",
    title: "Generate images and watch the agent test",
    changes: [
      {
        tag: "new",
        commit: "258ab84",
        text: "Added image generation, a live Preview Agent with reusable flows, collaboration UI, and multiple UX and reasoning fixes.",
      },
      {
        tag: "improved",
        commit: "a730acf",
        text: "Adopted the real VS Code Seti icon set and corrected composer height behavior.",
      },
      {
        tag: "fixed",
        commit: "458f3a1",
        text: "Applied Gemini 3.x thinking levels correctly and preserved text thought signatures across turns.",
      },
      {
        tag: "new",
        commit: "c781e97",
        text: "Added a working indicator and model-button picker, surfaced organization-workspace groundwork, and removed GPT-5.5 Pro.",
      },
    ],
  },
  {
    id: "v0-3-6",
    date: "Jun 18, 2026",
    ver: "v0.3.6",
    title: "GLM joins the model lineup",
    changes: [
      {
        tag: "new",
        commit: "dfeb14f",
        text: "Added Z.ai GLM-5.2 as a first-class provider with web search, thinking controls, and a vision bridge for screenshots.",
      },
      {
        tag: "fixed",
        commit: "2fe2fa9",
        text: "Threaded each user's Z.ai key through provider resolution so bring-your-own GLM usage works.",
      },
      {
        tag: "fixed",
        commit: "9aa1dcc",
        text: "Disabled compressed GLM streaming responses so tool calls and answer deltas arrive live.",
      },
    ],
  },
  {
    id: "v0-4-0",
    date: "Jun 22, 2026",
    ver: "v0.4.0",
    title: "The agent can divide and verify its work",
    changes: [
      {
        tag: "new",
        commit: "e4ebd65",
        text: "Added pre-deploy checks, sub-agents, connector detection, deployment secret sync, and OCR through the vision bridge.",
      },
      {
        tag: "improved",
        commit: "2feb1d8",
        text: "Added inline screenshot thumbnails, bounded screenshot storage, and smoother GLM thinking and tool-call streaming.",
      },
    ],
  },
  {
    id: "v0-4-1",
    date: "Jun 27, 2026",
    ver: "v0.4.1",
    title: "Guardrails and task-aware routing",
    changes: [
      {
        tag: "new",
        commit: "56cca67",
        text: "Added permission modes, task-aware Auto routing, ranged file reads, safer searches, and persistent Firecracker networking.",
      },
      {
        tag: "fixed",
        commit: "6f79995",
        text: "Fixed GLM web search configuration, guarded golden snapshots against staleness, and expanded project disks from 1 GB to 8 GB.",
      },
      {
        tag: "fixed",
        commit: "82b5af3",
        text: "Normalized malformed model plans so an invalid steps shape cannot crash the UI.",
      },
    ],
  },
  {
    id: "v0-4-2",
    date: "Jun 29, 2026",
    ver: "v0.4.2",
    title: "Auto explains itself, and users can steer",
    changes: [
      {
        tag: "new",
        commit: "c590659",
        text: "Showed Auto's per-turn model choice before streaming and allowed follow-up messages to steer a turn already in progress.",
      },
    ],
  },
  {
    id: "v0-4-3",
    date: "Jul 1, 2026",
    ver: "v0.4.3",
    title: "Watch parallel agents work",
    changes: [
      {
        tag: "new",
        commit: "83ae241",
        text: "Added concurrent background sub-agents, a live Activity Monitor, adaptive thinking controls, live cost, and default project skills.",
      },
      {
        tag: "improved",
        commit: "b425e11",
        text: "Refined preview labels, Activity access, plan and sub-agent accounting, Claude thinking traces, tool labels, skill auto-apply, and reduced-motion-aware animation.",
      },
    ],
  },
  {
    id: "v0-4-4",
    date: "Jul 2, 2026",
    ver: "v0.4.4",
    title: "Golden clones that stay writable and fast",
    changes: [
      {
        tag: "fixed",
        commit: "177e107",
        text: "Made /root writable on read-only golden clones, moved package-manager caches to project disks, guarded stale snapshots, and cut restore latency.",
      },
    ],
  },
  {
    id: "v0-5-0",
    date: "Jul 2, 2026",
    ver: "v0.5.0",
    title: "A sharper agent and a real skill catalog",
    changes: [
      {
        tag: "improved",
        commit: "cf707f0",
        text: "Reworked prompt caching, compaction, routing, tool guidance, and structured plans, then rewrote 17 design skills and added 8 focused skill packs.",
      },
    ],
  },
  {
    id: "v0-5-1",
    date: "Jul 2, 2026",
    ver: "v0.5.1",
    title: "Live work that stays live",
    changes: [
      {
        tag: "fixed",
        commit: "cf124d9",
        text: "Fixed memoization that froze streamed tool labels and added live file-diff estimates across execution, plan mode, and Gemini calls.",
      },
      {
        tag: "fixed",
        commit: "b9360be",
        text: "Made dependency installation understand subdirectory apps and replaced the flashing preview reload loop with an in-place readiness probe.",
      },
      {
        tag: "improved",
        commit: "30946cf",
        text: "Removed a fixed one-second golden-restore stall by retrying lost initial connections before the kernel retransmission timeout.",
      },
    ],
  },
  {
    id: "v0-5-2",
    date: "Jul 2, 2026",
    ver: "v0.5.2",
    title: "Plans become reviewable documents",
    changes: [
      {
        tag: "new",
        commit: "ffe0a1c",
        text: "Rebuilt plan review as a plain-English stage document with deliverables and optional technical detail, and reduced the model picker to a compact menu.",
      },
    ],
  },
  {
    id: "v0-5-3",
    date: "Jul 5, 2026",
    ver: "v0.5.3",
    title: "Numbers and reasoning that move correctly",
    changes: [
      {
        tag: "new",
        commit: "d526855",
        text: "Added low-biased live output-token and cost estimates throughout streaming, including across the plan-to-execute handoff.",
      },
      {
        tag: "improved",
        commit: "e82192b",
        text: "Pre-seeded Firecracker neighbor entries to remove another roughly one-second ARP delay from golden restores.",
      },
      {
        tag: "fixed",
        commit: "78966fc",
        text: "Made Gemini thought signatures model-specific and surfaced Gemini 3.5 Flash server-side searches as visible activity.",
      },
      {
        tag: "improved",
        commit: "1e9e49d",
        text: "Made streamed edit badges use a real line diff with smoothly rolling, reduced-motion-aware counters.",
      },
    ],
  },
  {
    id: "v0-5-4",
    date: "Jul 7, 2026",
    ver: "v0.5.4",
    title: "A public record, stronger signup protection, and honest cost",
    changes: [
      {
        tag: "new",
        commit: "9c43c01",
        text: "Added the pre-v1 changelog timeline and refreshed marketing pages, product documentation, and Firecracker documentation.",
      },
      {
        tag: "fixed",
        commit: "fc14d91",
        text: "Protected Gemini 3.x reasoning after switching from a non-Gemini model by replaying the documented dummy signature.",
      },
      {
        tag: "new",
        commit: "889a88e",
        text: "Added Cloudflare Turnstile protection to guest signup and restore, verified at the orchestrator trust boundary.",
      },
      {
        tag: "improved",
        commit: "25fba8c",
        text: "Excluded Vercel's local link metadata from version control.",
      },
      {
        tag: "fixed",
        commit: "8cd44fd",
        text: "Included image, vision, OCR, and planning spend in per-turn cost, repriced models, hardened checkpoint rewind, and polished deletion and reconnect states.",
      },
    ],
  },
  {
    id: "v0-6-0",
    date: "Jul 11, 2026",
    ver: "v0.6.0",
    title: "Sources you can follow and context you can trust",
    changes: [
      {
        tag: "new",
        commit: "f0955fe",
        text: "Added durable web citations, richer plan context, safer imported skills, project filtering and sorting, redesigned organization views, and repo-native Codex guidance.",
      },
    ],
  },
  {
    id: "v0-6-1",
    date: "Jul 11, 2026",
    ver: "v0.6.1",
    title: "A faster, more durable agent core",
    changes: [
      {
        tag: "improved",
        commit: "c6c5fc1",
        text: "Added task-matched prompt profiles, parallel tool scheduling, smarter compaction and output trimming, durable message and metric persistence, expanded model support, and hardened sandbox I/O.",
      },
    ],
  },
  {
    id: "v0-6-2",
    date: "Jul 12, 2026",
    ver: "v0.6.2",
    title: "Cleaner dashboards and production-ready sandbox tooling",
    changes: [
      {
        tag: "improved",
        commit: "05ea793",
        text: "Rebuilt organization dashboard surfaces, strengthened dependency and run-config detection, upgraded rootfs and host setup, and added a reproducible Rust toolchain installer.",
      },
    ],
  },
  {
    id: "v0-6-3",
    date: "Jul 12, 2026",
    ver: "v0.6.3",
    title: "A more consistent finish",
    changes: [
      {
        tag: "fixed",
        commit: "d329b29",
        text: "Aligned the dashboard composer with the workspace chat surface and restored the intended translucent marketing footer treatment.",
      },
    ],
  },
  {
    id: "v0-7-0",
    date: "Jul 13, 2026",
    ver: "v0.7.0",
    title: "Safer autonomy, clearer control, and new production domains",
    changes: [
      {
        tag: "improved",
        commit: "1c359b2",
        text: "Added live multi-agent activity, stronger run and secret controls, safer organization access, isolated previews, and moved production to gate15.dev with cookieless previews on gate15.app.",
      },
    ],
  },
];

const DISPLAY_ENTRIES = [...ENTRIES].reverse();

const NAV_ENTRIES: ChangelogNavEntry[] = DISPLAY_ENTRIES.map((entry) => ({
  href: `#${entry.id}`,
  date: entry.date,
  ver: entry.ver,
}));

export default function ChangelogPage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <span className="mk-eyebrow">
            <span className="dot" /> Changelog
          </span>
          <h1>
            What&rsquo;s <span className="grad">new</span>.
          </h1>
          <p className="mk-lede">
            Every substantive change on the road to v1.
          </p>
        </div>
      </section>

      <section className="mk-page wide">
        <div className="mk-changelog-layout">
          <ChangelogNav entries={NAV_ENTRIES} />

          <div className="changelog">
            {DISPLAY_ENTRIES.map((entry) => (
              <div className="changelog-entry" key={entry.ver} id={entry.id}>
                <div className="changelog-date">
                  {entry.date}
                  <br />
                  <span className="ver">{entry.ver}</span>
                </div>
                <div className="changelog-body">
                  <h3>{entry.title}</h3>
                  <ul>
                    {entry.changes.map((change) => (
                      <li key={change.commit}>
                        <span className={`change-tag tag-${change.tag}`}>
                          {change.tag}
                        </span>
                        <span>
                          {change.text}{" "}
                          <a
                            href={`${COMMIT_URL}${change.commit}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`View commit ${change.commit}`}
                            style={{
                              color: "inherit",
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              opacity: 0.62,
                              textDecoration: "none",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {change.commit}
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
