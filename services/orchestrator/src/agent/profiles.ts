import { createHash } from "node:crypto";

/**
 * Deterministic prompt/tool profiles for the coding harness.
 *
 * The classifier is deliberately conservative: only explicit, high-confidence
 * task signals select a progressive profile. Anything ambiguous keeps the
 * legacy (all guidance + all tools) profile, so an efficiency optimization can
 * never silently remove a capability from an unclear request.
 *
 * Capability order is canonical and stable. Providers cache prompt/tool
 * prefixes, so callers must append newly requested groups in this order and
 * never remove or reorder a group during a turn.
 */

export const CAPABILITY_IDS = [
  "design",
  "preview",
  "background",
  "integrations",
  "auth",
  "payments",
  "secrets",
  "assets",
  "knowledge",
  "deployment",
  "vision",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const GUIDANCE_PACK_IDS = [
  "design",
  "preview",
  "backend",
  "auth",
  "payments",
  "secrets",
  "assets",
  "deployment",
  "vision",
] as const;

export type GuidancePackId = (typeof GUIDANCE_PACK_IDS)[number];

export interface CapabilityDefinition {
  label: string;
  description: string;
  /** Names from tools.ts. `vision` is supplied by VISION_BRIDGE_TOOLS. */
  toolNames: readonly string[];
  /** Detailed operating guidance appended when this capability is loaded. */
  guidance: readonly GuidancePackId[];
}

export const CAPABILITY_DEFINITIONS: Record<CapabilityId, CapabilityDefinition> = {
  design: {
    label: "UI/design craft",
    description:
      "full visual-design, responsive, accessibility, and interaction-quality guidance",
    toolNames: [],
    guidance: ["design"],
  },
  preview: {
    label: "preview and browser QA",
    description:
      "dev-server lifecycle, screenshots, interactive browser checks, and saved smoke flows",
    toolNames: [
      "wait_for_port",
      "start_server",
      "stop_server",
      "list_servers",
      "read_server_log",
      "screenshot_preview",
      "interact_preview",
      "save_flow",
      "run_flow",
      "list_flows",
    ],
    guidance: ["preview"],
  },
  background: {
    label: "background jobs",
    description: "long-running non-preview commands and their logs/process controls",
    toolNames: [
      "run_in_background",
      "read_background_log",
      "list_background",
      "kill_background",
    ],
    guidance: [],
  },
  integrations: {
    label: "database and integrations",
    description: "connected databases, backend services, payments, and connector calls",
    toolNames: ["list_connectors", "call_connector"],
    guidance: ["backend"],
  },
  auth: {
    label: "end-user authentication",
    description:
      "complete login/signup/session flows with the connector, secret, preview, and deployment rails they require",
    toolNames: [
      "wait_for_port",
      "start_server",
      "stop_server",
      "list_servers",
      "read_server_log",
      "screenshot_preview",
      "interact_preview",
      "save_flow",
      "run_flow",
      "list_flows",
      "list_connectors",
      "call_connector",
      "list_secrets",
      "get_secret",
      "predeploy_check",
    ],
    guidance: ["preview", "backend", "auth", "secrets", "deployment"],
  },
  payments: {
    label: "payments",
    description:
      "Stripe checkout/portal flows with connector, secret, preview, and deployment guidance",
    toolNames: [
      "wait_for_port",
      "start_server",
      "stop_server",
      "list_servers",
      "read_server_log",
      "screenshot_preview",
      "interact_preview",
      "save_flow",
      "run_flow",
      "list_flows",
      "list_connectors",
      "call_connector",
      "list_secrets",
      "get_secret",
      "predeploy_check",
    ],
    guidance: ["preview", "backend", "payments", "secrets", "deployment"],
  },
  secrets: {
    label: "project secrets",
    description: "discover and safely plumb project environment variables",
    toolNames: ["list_secrets", "get_secret"],
    guidance: ["secrets"],
  },
  assets: {
    label: "uploads and image generation",
    description: "uploaded reference assets and paid raster image generation/editing",
    toolNames: ["generate_image", "list_assets", "read_asset"],
    guidance: ["assets"],
  },
  knowledge: {
    label: "knowledge library",
    description: "search the user's attached account-level reference documents",
    toolNames: ["knowledge_search"],
    guidance: [],
  },
  deployment: {
    label: "deployment readiness",
    description: "production builds and Vercel/serverless safety verification",
    toolNames: ["predeploy_check"],
    guidance: ["deployment"],
  },
  vision: {
    label: "vision bridge",
    description: "inspect screenshots, mockups, diagrams, charts, and image text on text-only models",
    toolNames: [],
    guidance: ["vision"],
  },
};

export interface AgentProfile {
  /** `legacy` preserves the historical full prompt and complete tool surface. */
  mode: "legacy" | "progressive";
  capabilities: readonly CapabilityId[];
  guidance: readonly GuidancePackId[];
  reason: string;
}

export type ProgressiveProfileCohort = "treatment" | "control" | "ineligible";

export interface CohortedAgentProfile {
  profile: AgentProfile;
  cohort: ProgressiveProfileCohort;
}

/**
 * Nested agents inherit the lead session's experiment assignment. Control and
 * ineligible leads stay entirely legacy so delegation cannot create an
 * unmeasured treatment inside an otherwise legacy run.
 */
export function applyInheritedSubagentCohort(
  candidate: AgentProfile,
  cohort: ProgressiveProfileCohort,
): AgentProfile {
  return cohort === "treatment" ? candidate : LEGACY_AGENT_PROFILE;
}

export const LEGACY_AGENT_PROFILE: AgentProfile = {
  mode: "legacy",
  capabilities: CAPABILITY_IDS,
  guidance: GUIDANCE_PACK_IDS,
  reason: "ambiguous task: fail-open to the complete legacy harness",
};

/**
 * Ship the prompt/tool slimming behind a real legacy control cohort until its
 * verification/correction rate is demonstrably non-inferior. One quarter of
 * eligible sessions gives useful treatment volume while limiting the quality
 * blast radius of a false-negative task-profile classification.
 */
export const DEFAULT_PROGRESSIVE_HARNESS_PERCENT = 25;

function progressiveRolloutPercent(): number {
  const raw = Number(
    process.env.UNIQUS_PROGRESSIVE_HARNESS_PERCENT ??
      String(DEFAULT_PROGRESSIVE_HARNESS_PERCENT),
  );
  if (!Number.isFinite(raw)) return DEFAULT_PROGRESSIVE_HARNESS_PERCENT;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Stable, privacy-safe experiment key. Assignment is sticky for one chat
 * session (and falls back to the project for headless callers without a
 * session), so successive turns cannot alternate harnesses and contaminate the
 * quality comparison. Only this domain-separated digest reaches cohorting;
 * project/session identifiers are never persisted as metric dimensions.
 */
export function progressiveHarnessCohortKey(
  projectId?: string | null,
  sessionId?: string | null,
): string | null {
  const project = projectId?.trim();
  const session = sessionId?.trim();
  if (!project && !session) return null;
  const scope = session
    ? `project:${project ?? "none"}:session:${session}`
    : `project:${project}`;
  return createHash("sha256")
    .update(`uniqus-progressive-harness-v1\0${scope}`)
    .digest("hex");
}

function stableBucket(key: string): number {
  // FNV-1a, sufficient for a stable privacy-safe rollout bucket. The key is a
  // one-way session/project digest in production and is never persisted as a
  // new dimension.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 10_000;
}

/**
 * Retain an eligible legacy control cohort so correction/verification quality
 * can be compared causally against prompt/tool slimming during rollout.
 */
export function applyProgressiveProfileCohort(
  candidate: AgentProfile,
  cohortKey?: string | null,
  percent = progressiveRolloutPercent(),
): CohortedAgentProfile {
  if (candidate.mode !== "progressive") {
    return { profile: candidate, cohort: "ineligible" };
  }
  const enabled =
    percent >= 100 ||
    (percent > 0 && !!cohortKey && stableBucket(cohortKey) < Math.round(percent * 100));
  return enabled
    ? { profile: candidate, cohort: "treatment" }
    : { profile: LEGACY_AGENT_PROFILE, cohort: "control" };
}

export interface TaskProfileSignals {
  /** A validated preview-picker target makes even "fix this" explicit UI work. */
  selectedElement?: boolean;
}

function canonicalCapabilities(ids: Iterable<CapabilityId>): CapabilityId[] {
  const wanted = new Set(ids);
  return CAPABILITY_IDS.filter((id) => wanted.has(id));
}

function canonicalGuidance(ids: Iterable<GuidancePackId>): GuidancePackId[] {
  const wanted = new Set(ids);
  return GUIDANCE_PACK_IDS.filter((id) => wanted.has(id));
}

function progressive(
  capabilities: Iterable<CapabilityId>,
  guidance: Iterable<GuidancePackId>,
  reason: string,
): AgentProfile {
  return {
    mode: "progressive",
    capabilities: canonicalCapabilities(capabilities),
    guidance: canonicalGuidance(guidance),
    reason,
  };
}

/**
 * Select a top-level profile from explicit words/paths in the current request.
 * No model call and no repository state are involved, keeping this cheap,
 * deterministic, and cache-friendly. If no domain is certain, return legacy.
 */
export function selectTaskProfile(
  message: string,
  signals: TaskProfileSignals = {},
): AgentProfile {
  // Server-added upload/@file evidence can contain arbitrary source code and
  // domain words unrelated to the user's requested operation. Classify only
  // the directive before those stable trailers; otherwise attaching App.tsx to
  // a backend audit would accidentally activate the complete UI profile.
  const trailerMarkers = [
    "\n\nUploaded files are already available",
    "\n\nThe user @-referenced these files",
    "\n\n<live-project-state>",
  ];
  let directiveEnd = message.length;
  for (const marker of trailerMarkers) {
    const at = message.indexOf(marker);
    if (at >= 0) directiveEnd = Math.min(directiveEnd, at);
  }
  const text = message.slice(0, directiveEnd).slice(0, 8_000).toLowerCase();
  const capabilities = new Set<CapabilityId>();
  const guidance = new Set<GuidancePackId>();
  const reasons: string[] = [];

  const add = (
    reason: string,
    caps: readonly CapabilityId[],
    packs: readonly GuidancePackId[],
  ): void => {
    reasons.push(reason);
    caps.forEach((id) => capabilities.add(id));
    packs.forEach((id) => guidance.add(id));
  };

  const ui =
    signals.selectedElement === true ||
    /\b(ui|ux|frontend|front-end|landing page|dashboard|component|responsive|css|scss|tailwind|layout|styling|visual|navbar|sidebar|modal|design system)\b/.test(text) ||
    /\.(tsx|jsx|css|scss|sass|less)\b/.test(text);
  const preview = /\b(preview|browser|screenshot|viewport|playwright|interaction|smoke flow|visual qa)\b/.test(text);
  const auth = /\b(auth|authentication|login|log in|sign-in|signin|signup|sign-up|logout|password reset|oauth|session|supabase auth)\b/.test(text);
  const payments = /\b(stripe|payment|checkout|subscription|billing|invoice|customer portal)\b/.test(text);
  const backend =
    /\b(backend|api|api route|route handler|database|schema|migration|sql|postgres|supabase|persistence|webhook)\b/.test(text) ||
    /(?:^|[\\/])(api|server|db|database)(?:[\\/]|$)/.test(text);
  const secrets =
    /\b(secret|environment variable|env var|api key|credential)\b/.test(text) || /\.env\b/.test(text);
  const deployment = /\b(deploy|deployment|vercel|serverless|production build|predeploy|ship to prod|production readiness)\b/.test(text);
  const assets = /\b(asset|upload|image|illustration|logo|hero image|mockup|photo|icon|pdf|csv)\b/.test(text);
  const background = /\b(background job|worker|queue|long-running|cron|job log)\b/.test(text);
  const knowledge = /\b(knowledge library|uploaded document|reference document|company policy|source document)\b/.test(text);
  const codeArtifact =
    /\b(code|codebase|repository|repo|file|module|function|class|method|server|client|loop|agent|harness|latency|performance|concurrency|race condition|memory|token|prompt|tool|typescript|javascript|rust|python)\b/.test(text) ||
    /\.(ts|js|mjs|cjs|rs|py|go|java|rb|php|cs|cpp|c|h|json|ya?ml|toml|md)\b/.test(text);
  const coreEngineering =
    /\b(typecheck|lint|telemetry|instrumentation|race condition)\b/.test(text) ||
    (codeArtifact && /\b(investigate|audit|review|debug|bug|fix|refactor|test|optimize|improve)\b/.test(text));

  if (ui) add(signals.selectedElement ? "selected preview element" : "explicit frontend/UI task", ["design", "preview", "assets", "deployment"], ["design", "preview", "assets", "deployment"]);
  if (preview) add("explicit preview/browser task", ["preview"], ["preview"]);
  if (auth) add("explicit authentication task", ["preview", "integrations", "auth", "secrets", "deployment"], ["backend", "auth", "secrets", "preview", "deployment"]);
  if (payments) add("explicit payments task", ["preview", "integrations", "payments", "secrets", "deployment"], ["backend", "payments", "secrets", "preview", "deployment"]);
  if (backend) add("explicit backend/data task", ["integrations", "secrets", "deployment"], ["backend", "secrets", "deployment"]);
  if (secrets) add("explicit secrets/env task", ["secrets"], ["secrets"]);
  if (deployment) add("explicit deployment task", ["deployment", "preview", "secrets"], ["deployment", "preview", "secrets"]);
  if (assets) add("explicit asset task", ["assets"], ["assets"]);
  if (background) add("explicit background-job task", ["background", "deployment"], ["deployment"]);
  if (knowledge) add("explicit knowledge-library task", ["knowledge"], []);
  if (coreEngineering) reasons.push("explicit code/research task");

  // A generic request such as "build me an app" is intentionally NOT guessed.
  // It receives the full legacy profile until the task names a concrete domain.
  if (reasons.length === 0) return LEGACY_AGENT_PROFILE;

  return progressive(capabilities, guidance, reasons.join("; "));
}

/** Add the guidance coupled to a newly loaded capability, preserving order. */
export function guidanceForCapabilities(
  ids: Iterable<CapabilityId>,
  options: { hasNativeVision?: boolean } = {},
): GuidancePackId[] {
  const packs = new Set<GuidancePackId>();
  for (const id of ids) {
    // Native multimodal models already receive pixels directly. Installing the
    // text-only bridge recipe would tell them to call schemas that are
    // deliberately absent from their tool list.
    if (id === "vision" && options.hasNativeVision) continue;
    CAPABILITY_DEFINITIONS[id].guidance.forEach((pack) => packs.add(pack));
  }
  return canonicalGuidance(packs);
}

/** Merge system-resident guidance extensions without duplicates or reordering. */
export function mergeGuidancePacks(
  current: Iterable<GuidancePackId>,
  added: Iterable<GuidancePackId>,
): GuidancePackId[] {
  return canonicalGuidance([...current, ...added]);
}

/** Constant catalog text: it never encodes per-turn loaded state, preserving the prompt prefix. */
export function formatCapabilityCatalog(): string {
  return CAPABILITY_IDS.map(
    (id) => `  • ${id} — ${CAPABILITY_DEFINITIONS[id].description}`,
  ).join("\n");
}
