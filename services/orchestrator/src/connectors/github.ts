import type { ConnectorDefinition } from "./index.js";

/**
 * GitHub connector. Uses a token from project secrets (default GITHUB_TOKEN).
 *
 * For Phase 2 we ship the read-shaped methods most ops tools need —
 * list/get issues, list/get PRs. The Phase-3 "create issue / open PR /
 * push branch" methods plug in here without changing the connector
 * contract; gated by user-defined builder tier when permissions land.
 */
export const githubConnector: ConnectorDefinition = {
  id: "github",
  name: "GitHub",
  description: "Read issues and pull requests via the GitHub REST API.",
  methods: [
    {
      name: "list_issues",
      description: "List issues for a repo. Pulls token from secrets (default GITHUB_TOKEN).",
      args_schema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "all"] },
          per_page: { type: "number" },
          token_secret: { type: "string", description: "Optional. Default 'GITHUB_TOKEN'." },
        },
        required: ["owner", "repo"],
      },
      invoke: async (ctx, args) => {
        return await ghRequest(ctx, args, (token) => {
          const url = new URL(`https://api.github.com/repos/${args.owner}/${args.repo}/issues`);
          if (typeof args.state === "string") url.searchParams.set("state", args.state);
          url.searchParams.set("per_page", String(Math.min(Number(args.per_page) || 30, 100)));
          return { url: url.toString(), token };
        });
      },
    },
    {
      name: "get_issue",
      description: "Get a single issue or PR by number.",
      args_schema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          number: { type: "number" },
          token_secret: { type: "string" },
        },
        required: ["owner", "repo", "number"],
      },
      invoke: async (ctx, args) => {
        return await ghRequest(ctx, args, (token) => ({
          url: `https://api.github.com/repos/${args.owner}/${args.repo}/issues/${Number(args.number)}`,
          token,
        }));
      },
    },
    {
      name: "list_pulls",
      description: "List pull requests for a repo.",
      args_schema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "all"] },
          per_page: { type: "number" },
          token_secret: { type: "string" },
        },
        required: ["owner", "repo"],
      },
      invoke: async (ctx, args) => {
        return await ghRequest(ctx, args, (token) => {
          const url = new URL(`https://api.github.com/repos/${args.owner}/${args.repo}/pulls`);
          if (typeof args.state === "string") url.searchParams.set("state", args.state);
          url.searchParams.set("per_page", String(Math.min(Number(args.per_page) || 30, 100)));
          return { url: url.toString(), token };
        });
      },
    },
  ],
};

async function ghRequest(
  ctx: { secret: (name: string) => Promise<string> },
  args: Record<string, unknown>,
  build: (token: string) => { url: string; token: string },
): Promise<unknown> {
  const tokenName = typeof args.token_secret === "string" && args.token_secret
    ? args.token_secret
    : "GITHUB_TOKEN";
  const token = await ctx.secret(tokenName);
  const { url } = build(token);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub API ${res.status}: ${t.slice(0, 500)}`);
  }
  return await res.json();
}
