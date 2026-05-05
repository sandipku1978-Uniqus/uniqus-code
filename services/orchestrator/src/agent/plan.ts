import Anthropic from "@anthropic-ai/sdk";
import type { Plan } from "@uniqus/api-types";
import { normalizeMessageHistory } from "./messageHistory.js";

const PLAN_MODEL = "claude-opus-4-7";

const PLAN_SYSTEM_PROMPT = `You are an AI software engineer in plan mode. The user has described what they want built; your job is to produce a structured plan, NOT to execute it.

Use the submit_plan tool to return:
- A one-paragraph summary of what will be built and how it will work.
- A list of concrete steps. Each step should be small enough to verify on its own — typically one file created, one command run, or one integration completed. Aim for 4–10 steps.
- For each step, list the files it will touch (if any) and a one-line success criterion (how the agent will know the step worked).

Be specific about file names, frameworks, and commands when the existing context supports it. For an existing or imported project where structure is unclear, include one bounded discovery step first (for example: inspect package.json and the relevant source tree), then concrete implementation steps.`;

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
): Promise<Plan> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: 4096,
    system: PLAN_SYSTEM_PROMPT,
    tools: [SUBMIT_PLAN_TOOL],
    tool_choice: { type: "tool", name: "submit_plan" },
    messages: normalizeMessageHistory([...history, { role: "user", content: userMessage }]),
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use" || block.name !== "submit_plan") {
    throw new Error("Plan model did not return a submit_plan tool call");
  }
  return block.input as Plan;
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
