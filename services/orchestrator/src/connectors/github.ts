import type { ConnectorDefinition } from "./index.js";
import { validatePathComponent, safeFetch } from "./ssrfGuard.js";

/** Validate + URL-encode an owner/repo segment so it can't traverse to other endpoints (L-8). */
function repoPath(args: Record<string, unknown>): { owner: string; repo: string } {
  return {
    owner: encodeURIComponent(validatePathComponent(String(args.owner ?? ""), "owner")),
    repo: encodeURIComponent(validatePathComponent(String(args.repo ?? ""), "repo")),
  };
}

/**
 * Validate a git branch/ref name. Unlike owner/repo, a branch can legitimately
 * contain '/' (e.g. feature/login), so we allow it but reject traversal/control
 * chars and use the value raw (the slashes are literal path separators in the
 * GitHub ref endpoints — percent-encoding them would break the lookup).
 */
function validateBranch(value: string, label = "branch"): string {
  const v = value.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(v) || v.includes("..") || v.startsWith("/") || v.endsWith("/")) {
    throw new Error(`invalid ${label}: must match [A-Za-z0-9._/-]+ (no '..', no leading/trailing '/')`);
  }
  return v;
}

/**
 * GitHub connector. Uses a token from project secrets (default GITHUB_TOKEN).
 *
 * Ships the read methods most ops tools need (list/get issues + PRs) AND the
 * write methods for a PR workflow (P1.2): create_branch, create_pull,
 * list_pull_comments, get_branch. The token needs `repo` scope for writes.
 */
export const githubConnector: ConnectorDefinition = {
  id: "github",
  name: "GitHub",
  description: "Read AND write GitHub via the REST API: list/get issues + PRs, create branches, open pull requests, read PR comments.",
  methods: [
    {
      name: "list_issues",
      risk: "read",
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
          const { owner, repo } = repoPath(args);
          const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
          if (typeof args.state === "string") url.searchParams.set("state", args.state);
          url.searchParams.set("per_page", String(Math.min(Number(args.per_page) || 30, 100)));
          return { url: url.toString(), token };
        });
      },
    },
    {
      name: "get_issue",
      risk: "read",
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
        return await ghRequest(ctx, args, (token) => {
          const { owner, repo } = repoPath(args);
          return {
            url: `https://api.github.com/repos/${owner}/${repo}/issues/${Number(args.number)}`,
            token,
          };
        });
      },
    },
    {
      name: "list_pulls",
      risk: "read",
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
          const { owner, repo } = repoPath(args);
          const url = new URL(`https://api.github.com/repos/${owner}/${repo}/pulls`);
          if (typeof args.state === "string") url.searchParams.set("state", args.state);
          url.searchParams.set("per_page", String(Math.min(Number(args.per_page) || 30, 100)));
          return { url: url.toString(), token };
        });
      },
    },
    {
      name: "get_branch",
      risk: "read",
      description: "Get a branch (its latest commit sha + protection). Useful before opening a PR or branching from it.",
      args_schema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string" },
          token_secret: { type: "string" },
        },
        required: ["owner", "repo", "branch"],
      },
      invoke: async (ctx, args) => {
        const token = await ghToken(ctx, args);
        const { owner, repo } = repoPath(args);
        const branch = validateBranch(String(args.branch ?? ""));
        return await ghApi(token, "GET", `https://api.github.com/repos/${owner}/${repo}/branches/${branch}`);
      },
    },
    {
      name: "create_branch",
      risk: "write",
      description:
        "Create a new branch off an existing one. from_branch defaults to the repo default (commonly 'main'). Resolves the base sha, then creates refs/heads/<branch>.",
      args_schema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string", description: "New branch name." },
          from_branch: { type: "string", description: "Base branch (default 'main')." },
          token_secret: { type: "string" },
        },
        required: ["owner", "repo", "branch"],
      },
      invoke: async (ctx, args) => {
        const token = await ghToken(ctx, args);
        const { owner, repo } = repoPath(args);
        const branch = validateBranch(String(args.branch ?? ""));
        const fromBranch = validateBranch(String(args.from_branch ?? "main"), "from_branch");
        const base = (await ghApi(
          token,
          "GET",
          `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`,
        )) as { object?: { sha?: string } };
        const sha = base?.object?.sha;
        if (!sha) throw new Error(`could not resolve sha for base branch '${fromBranch}'`);
        return await ghApi(token, "POST", `https://api.github.com/repos/${owner}/${repo}/git/refs`, {
          ref: `refs/heads/${branch}`,
          sha,
        });
      },
    },
    {
      name: "create_pull",
      risk: "write",
      description:
        "Open a pull request from head into base (base defaults to 'main'). Returns the PR number + html_url. Requires the branch to already exist and have commits ahead of base.",
      args_schema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          head: { type: "string", description: "Source branch (your changes)." },
          base: { type: "string", description: "Target branch (default 'main')." },
          body: { type: "string", description: "PR description (markdown)." },
          draft: { type: "boolean", description: "Open as a draft PR. Optional." },
          token_secret: { type: "string" },
        },
        required: ["owner", "repo", "title", "head"],
      },
      invoke: async (ctx, args) => {
        const token = await ghToken(ctx, args);
        const { owner, repo } = repoPath(args);
        const head = validateBranch(String(args.head ?? ""), "head");
        const base = validateBranch(String(args.base ?? "main"), "base");
        return await ghApi(token, "POST", `https://api.github.com/repos/${owner}/${repo}/pulls`, {
          title: String(args.title ?? ""),
          head,
          base,
          body: typeof args.body === "string" ? args.body : undefined,
          draft: args.draft === true,
        });
      },
    },
    {
      name: "list_pull_comments",
      risk: "read",
      description: "List the issue-style comments on a pull request (the GitHub /issues/{number}/comments endpoint also serves PRs).",
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
        const token = await ghToken(ctx, args);
        const { owner, repo } = repoPath(args);
        return await ghApi(
          token,
          "GET",
          `https://api.github.com/repos/${owner}/${repo}/issues/${Number(args.number)}/comments`,
        );
      },
    },
  ],
};

/** Resolve the GitHub token from project secrets (default GITHUB_TOKEN). */
async function ghToken(
  ctx: { secret: (name: string) => Promise<string> },
  args: Record<string, unknown>,
): Promise<string> {
  const tokenName = typeof args.token_secret === "string" && args.token_secret ? args.token_secret : "GITHUB_TOKEN";
  return ctx.secret(tokenName);
}

/**
 * One authenticated GitHub REST call via safeFetch with maxRedirects=0 — the
 * token is attached, so a 30x must never bounce it off-host (H-2). Closes the
 * old raw-fetch gap that skipped redirect re-validation.
 */
async function ghApi(token: string, method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await safeFetch(
    url,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    0,
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub API ${res.status}: ${t.slice(0, 500)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function ghRequest(
  ctx: { secret: (name: string) => Promise<string> },
  args: Record<string, unknown>,
  build: (token: string) => { url: string; token: string },
): Promise<unknown> {
  const token = await ghToken(ctx, args);
  const { url } = build(token);
  return await ghApi(token, "GET", url);
}
