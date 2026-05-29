import Anthropic from "@anthropic-ai/sdk";
import type { ModelChoice, Plan } from "@uniqus/api-types";
import { normalizeMessageHistory } from "./messageHistory.js";
import { formatAccountPromptForPrompt, formatSkillsForPrompt } from "./skills.js";
import { resolveModel } from "./router.js";
import { getProvider, providerKeysFromEnv, type ProviderKeys } from "./providers/index.js";

const PLAN_SYSTEM_PROMPT_BASE = `You are an AI software engineer in plan mode. The user has described what they want built; your job is to produce a structured plan, NOT to execute it.

Use the submit_plan tool to return:
- A one-paragraph summary of what will be built and how it will work.
- A list of concrete steps. Each step should be small enough to verify on its own — typically one file created, one command run, or one integration completed. Aim for 4–10 steps.
- For each step, list the files it will touch (if any) and a one-line success criterion (how the agent will know the step worked).

Be specific about file names, frameworks, and commands when the existing context supports it. For an existing or imported project where structure is unclear, include one bounded discovery step first (for example: inspect package.json and the relevant source tree), then concrete implementation steps.

When planning frontend or design work, include steps for:
- Finding existing design tokens, components, routes, assets, and styling conventions before proposing new ones.
- Building the real usable screen or flow, including responsive layout, empty/loading/error states, accessibility, and plausible content.
- Starting or reusing a preview server and checking the result visually at desktop and mobile sizes before declaring the work complete.`;

const SUBMIT_PLAN_TOOL: Anthropic.Tool = {
  name: "submit_plan",
  description: "Submit a structured implementation plan for the user's request.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One-paragraph summary of what will be built.",
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

export async function proposePlan(
  userMessage: string,
  apiKey: string,
  history: Anthropic.MessageParam[] = [],
  skills: string | null = null,
  modelChoice?: ModelChoice,
  providerKeys?: ProviderKeys,
  accountPrompt: string | null = null,
): Promise<Plan> {
  const system = `${PLAN_SYSTEM_PROMPT_BASE}${formatAccountPromptForPrompt(accountPrompt)}${formatSkillsForPrompt(skills)}`;

  // Plan mode honors the same per-turn model choice as the agent loop, so the
  // plan is drafted by whichever model the user selected.
  const resolved = resolveModel("plan", modelChoice);
  const keys: ProviderKeys = providerKeys ?? { ...providerKeysFromEnv(), anthropic: apiKey };
  const provider = getProvider(resolved.provider, keys);

  const input = await provider.callForcedTool({
    model: resolved.model,
    system,
    tool: SUBMIT_PLAN_TOOL,
    messages: normalizeMessageHistory([...history, { role: "user", content: userMessage }]),
    maxTokens: 4096,
  });
  return input as Plan;
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
