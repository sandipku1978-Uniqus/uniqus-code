import Anthropic from "@anthropic-ai/sdk";
import type { ModelChoice, Plan, PlanStep } from "@uniqus/api-types";
import { normalizeMessageHistory } from "./messageHistory.js";
import { formatAccountPromptForPrompt, formatSkillsForPrompt } from "./skills.js";
import { resolveModel } from "./router.js";
import {
  pickAutoModel,
  availableProvidersFromKeys,
  turnReferencesImage,
} from "./autoRouter.js";
import { getProvider, providerKeysFromEnv, type ProviderKeys } from "./providers/index.js";
import { TOOLS } from "./tools.js";
import { executeTool, truncateToolResultText, type LoopHooks } from "./loop.js";
import type { Sandbox } from "./sandbox.js";
import { PLAN_DESIGN_STEP_LINE } from "./designGuidance.js";

const PLAN_SYSTEM_PROMPT_BASE = `You are an AI software engineer in plan mode. The user has described what they want built; your job is to INSPECT the project as needed and then produce a structured plan, NOT to execute it.

You have READ-ONLY tools to ground the plan in reality: read_file, list_dir, grep, list_assets, and read_asset. For an existing or imported project, USE them before planning — check package.json, the framework, the directory layout, the files you'll touch, and any uploaded reference assets. Do NOT guess at file names or structure you can verify. You cannot modify files, run commands, or start servers in plan mode.

When you have enough understanding, call the submit_plan tool to return:
- A plain_summary: ONE plain-English sentence a non-technical person understands, describing what they'll get — NOT how it's built. No file names, frameworks, or jargon. E.g. "I'll build a simple expense tracker where you can add expenses and watch a running total." This is the headline the user reads first.
- A one-paragraph technical summary of what will be built and how it will work (this is the detailed, secondary view).
- A list of concrete steps. Each step should be small enough to verify on its own — typically one file created, one command run, or one integration completed. Aim for 4–10 steps.
- For each step, list the files it will touch (if any) and a one-line success criterion (how the agent will know the step worked).

Be specific about file names, frameworks, and commands, grounded in what you actually saw. For a brand-new project where there is nothing to inspect, skip straight to the plan.

For a plan whose result is a VISUAL screen or app, optionally include a "wireframe": a small ASCII sketch of the primary screen's layout (boxes + labels for header / nav / main regions / key components) so a non-technical user can picture it before anything is built. Keep it under ~16 lines and ASCII-only (no HTML/SVG). Omit it for backend-only or CLI work. A real rendered screenshot is impossible in plan mode — nothing is running yet — so this sketch is the substitute.

When planning frontend or design work, include steps for:
- Finding existing design tokens, components, routes, assets, and styling conventions before proposing new ones.
${PLAN_DESIGN_STEP_LINE}
- Building the real usable screen or flow, including responsive layout, empty/loading/error states, accessibility, and plausible content.
- Starting or reusing a preview server and checking the result visually at desktop and mobile sizes before declaring the work complete.

ALWAYS finish by calling submit_plan. Keep any narration before it brief — a sentence on what you're checking is enough; the user can see your tool calls.`;

/** Read-only tools the planner may use to investigate before proposing a plan. */
const PLAN_READONLY_TOOL_NAMES = new Set([
  "read_file",
  "list_dir",
  "grep",
  "list_assets",
  "read_asset",
]);

/** Hooks to stream the planner's investigation (text, reasoning, tool activity). */
export type PlanHooks = Pick<
  LoopHooks,
  "onText" | "onThinking" | "onToolCallStarted" | "onToolCall" | "onToolResult"
>;

export interface PlanOptions {
  apiKey: string;
  /** Sandbox the planner inspects with read-only tools. */
  sandbox: Sandbox;
  history?: Anthropic.MessageParam[];
  skills?: string | null;
  accountPrompt?: string | null;
  modelChoice?: ModelChoice;
  providerKeys?: ProviderKeys;
  projectId?: string | null;
  signal?: AbortSignal;
  /** Stream the planner's progress to the client (same events as the agent loop). */
  hooks?: PlanHooks;
}

const MAX_PLAN_ITERATIONS = 16;
const PLAN_MAX_TOKENS = 8192;

/**
 * The model fills in the submit_plan tool, but a model CAN return a malformed
 * shape: a truncated GLM tool-call parses to `{}` (no `steps`), or `steps` comes
 * back as a JSON string / single object instead of an array. We send the Plan
 * straight to the UI, where `plan.steps.map(...)` then HARD-CRASHES the whole
 * message ("steps.map is not a function") — and `formatPlanForExecution` below
 * also assumes an array. Normalize defensively so we ALWAYS emit a well-formed
 * Plan: `steps` is a PlanStep[] (possibly empty), text fields are strings. This
 * matters more now that plan mode is task-routed and can land on GLM. Pairs with
 * the UI's own array guard (belt and suspenders).
 */
export function normalizePlan(raw: unknown): Plan {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") obj = parsed as Record<string, unknown>;
    } catch {
      /* whole plan wasn't JSON — leave obj empty */
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }

  const toStep = (s: unknown): PlanStep | null => {
    if (typeof s === "string") {
      const description = s.trim();
      return description ? { description } : null;
    }
    if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      const description =
        typeof o.description === "string" ? o.description : String(o.description ?? "").trim();
      const files = Array.isArray(o.files)
        ? o.files.filter((f): f is string => typeof f === "string")
        : undefined;
      const success_criteria =
        typeof o.success_criteria === "string" ? o.success_criteria : undefined;
      return {
        description,
        ...(files && files.length ? { files } : {}),
        ...(success_criteria ? { success_criteria } : {}),
      };
    }
    return null;
  };

  let rawSteps: unknown = obj.steps;
  if (typeof rawSteps === "string") {
    try {
      rawSteps = JSON.parse(rawSteps) as unknown;
    } catch {
      /* steps wasn't a JSON array string */
    }
  }
  const steps: PlanStep[] = Array.isArray(rawSteps)
    ? rawSteps.map(toStep).filter((s): s is PlanStep => s !== null)
    : [];

  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const plain_summary = typeof obj.plain_summary === "string" ? obj.plain_summary : undefined;
  const wireframe = typeof obj.wireframe === "string" ? obj.wireframe : undefined;

  return {
    summary: summary || plain_summary || "Proposed plan",
    steps,
    ...(plain_summary ? { plain_summary } : {}),
    ...(wireframe ? { wireframe } : {}),
  };
}

const SUBMIT_PLAN_TOOL: Anthropic.Tool = {
  name: "submit_plan",
  description: "Submit a structured implementation plan for the user's request.",
  input_schema: {
    type: "object",
    properties: {
      plain_summary: {
        type: "string",
        description:
          "ONE plain-English sentence a non-technical user understands — what they'll get, not how it's built. No file names or jargon.",
      },
      summary: {
        type: "string",
        description: "One-paragraph technical summary of what will be built and how.",
      },
      wireframe: {
        type: "string",
        description:
          "Optional ASCII wireframe of the primary screen (boxes + labels), ≤16 lines, ASCII-only. Omit for backend/CLI work.",
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Files this step will create or modify.",
            },
            success_criteria: {
              type: "string",
              description: "How the agent will know this step succeeded.",
            },
          },
          required: ["description"],
        },
      },
    },
    required: ["summary", "steps"],
  },
};

/**
 * Draft a plan, letting the model first INVESTIGATE the project with read-only
 * tools and STREAMING its progress (text, reasoning, tool calls) to the client
 * via `opts.hooks` — the same events the execute loop emits, so the user sees
 * the planner work. It loops until the model calls submit_plan; a final forced
 * submit_plan guarantees a structured Plan if it ends without one. Runs on a
 * COPY of history, so the (transient) investigation isn't persisted.
 */
export async function proposePlan(userMessage: string, opts: PlanOptions): Promise<Plan> {
  const system = `${PLAN_SYSTEM_PROMPT_BASE}${formatAccountPromptForPrompt(
    opts.accountPrompt ?? null,
  )}${formatSkillsForPrompt(opts.skills ?? null)}`;

  // Plan mode honors the same per-turn model choice as the agent loop.
  const keys: ProviderKeys = opts.providerKeys ?? {
    ...providerKeysFromEnv(),
    anthropic: opts.apiKey,
  };
  let resolved = resolveModel("plan", opts.modelChoice);
  // Task-aware Auto (same as the agent loop): when on Auto, route per task —
  // plan mode leans toward the stronger reasoner. Best-effort; keeps the static
  // default on any failure. See agent/autoRouter.ts.
  if (!resolved.overridden) {
    const picked = await pickAutoModel(
      "plan",
      {
        userMessage,
        hasImages: turnReferencesImage(userMessage, opts.history),
        availableProviders: availableProvidersFromKeys(keys),
      },
      { anthropicKey: keys.anthropic },
    );
    if (picked) resolved = picked;
  }
  const provider = getProvider(resolved.provider, keys);
  const hooks = opts.hooks ?? {};

  const planTools: Anthropic.Tool[] = [
    ...TOOLS.filter((t) => PLAN_READONLY_TOOL_NAMES.has(t.name)),
    SUBMIT_PLAN_TOOL,
  ];

  const messages: Anthropic.MessageParam[] = normalizeMessageHistory([
    ...(opts.history ?? []),
    { role: "user", content: userMessage },
  ]);

  for (let iter = 0; iter < MAX_PLAN_ITERATIONS; iter++) {
    if (opts.signal?.aborted) throw new Error("aborted before plan");

    let turn;
    try {
      turn = await provider.streamAgentTurn({
        model: resolved.model,
        system,
        tools: planTools,
        messages,
        maxTokens: PLAN_MAX_TOKENS,
        signal: opts.signal,
        onText: hooks.onText,
        onThinking: hooks.onThinking,
        onToolCallStarted: hooks.onToolCallStarted,
        onToolCall: hooks.onToolCall,
        onToolResult: hooks.onToolResult,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw new Error("aborted during plan");
      throw err;
    }

    messages.push({ role: "assistant", content: turn.content });

    // The model submitted its plan — done.
    const submitted = turn.toolCalls.find((c) => c.name === "submit_plan");
    if (submitted) return normalizePlan(submitted.input);

    // No tools and no plan: it just talked. Force a plan to finish.
    if (turn.toolCalls.length === 0) break;

    // Execute the read-only investigation tools and feed results back.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of turn.toolCalls) {
      if (opts.signal?.aborted) throw new Error("aborted during plan");
      try {
        const result = await executeTool(
          opts.sandbox,
          call.name,
          call.input,
          call.id,
          opts.projectId ?? null,
          null,
          undefined,
          opts.signal,
          undefined,
          undefined,
          undefined,
          null,
        );
        if (result && typeof result === "object" && (result as { __multimodal?: boolean }).__multimodal) {
          const mm = result as { content: Array<{ type: string; [k: string]: unknown }> };
          const textSummary = mm.content.find((b) => b.type === "text") as { text: string } | undefined;
          hooks.onToolResult?.(call.id, call.name, call.input, textSummary?.text ?? "(image)", false);
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: mm.content as unknown as Anthropic.ToolResultBlockParam["content"],
          });
        } else {
          const text = truncateToolResultText(
            (typeof result === "string" ? result : JSON.stringify(result)) || "(no output)",
          );
          hooks.onToolResult?.(call.id, call.name, call.input, text, false);
          toolResults.push({ type: "tool_result", tool_use_id: call.id, content: text });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        hooks.onToolResult?.(call.id, call.name, call.input, msg, true);
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Error: ${msg}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Fallback: the model investigated but didn't submit (or hit the cap) — force
  // a structured plan so the user always gets one.
  const forced = await provider.callForcedTool({
    model: resolved.model,
    system,
    tool: SUBMIT_PLAN_TOOL,
    messages: normalizeMessageHistory(messages),
    maxTokens: 4096,
    signal: opts.signal,
  });
  return normalizePlan(forced);
}

export function formatPlanForExecution(plan: Plan): string {
  const lines = [`Approved plan: ${plan.summary}`, "", "Steps:"];
  plan.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.description}`);
    if (step.files && step.files.length > 0) {
      lines.push(`   Files: ${step.files.join(", ")}`);
    }
    if (step.success_criteria) {
      lines.push(`   Success: ${step.success_criteria}`);
    }
  });
  lines.push("", "Now execute the plan. Use the tools to do the work, fix errors as they arise, and summarize at the end.");
  return lines.join("\n");
}
