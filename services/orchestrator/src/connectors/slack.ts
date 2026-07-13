import type { ConnectorDefinition } from "./index.js";

/**
 * Slack connector. Two methods cover ~80% of ops use cases:
 *   - post_webhook  → fire-and-forget message via incoming-webhook URL
 *     (stored in project secrets). Simplest to set up; no token scopes.
 *   - post_message  → real chat.postMessage with a bot token (more flexible:
 *     mentions, threads, blocks).
 *
 * The bot-token method requires SLACK_BOT_TOKEN in project secrets with
 * `chat:write` scope at minimum.
 */
export const slackConnector: ConnectorDefinition = {
  id: "slack",
  name: "Slack",
  description: "Post messages to Slack via incoming webhook or chat.postMessage.",
  methods: [
    {
      name: "post_webhook",
      risk: "write",
      description: "Post a message to a Slack channel via an incoming-webhook URL. Provide webhook_secret as the name of the secret holding the webhook URL.",
      args_schema: {
        type: "object",
        properties: {
          webhook_secret: {
            type: "string",
            description: "Secret name holding the incoming-webhook URL (e.g. 'SLACK_WEBHOOK_URL').",
          },
          text: { type: "string" },
          blocks: { type: "array", description: "Optional Slack block-kit blocks." },
        },
        required: ["webhook_secret", "text"],
      },
      invoke: async (ctx, args) => {
        const url = await ctx.secret(String(args.webhook_secret));
        if (!/^https:\/\/hooks\.slack\.com\//.test(url)) {
          throw new Error("webhook_secret value is not a Slack webhook URL");
        }
        const body: Record<string, unknown> = { text: args.text };
        if (Array.isArray(args.blocks)) body.blocks = args.blocks;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok || text !== "ok") {
          throw new Error(`Slack webhook returned ${res.status}: ${text}`);
        }
        return { ok: true };
      },
    },
    {
      name: "post_message",
      risk: "write",
      description: "Post a message via chat.postMessage. Requires SLACK_BOT_TOKEN secret with chat:write scope (or the secret name in token_secret).",
      args_schema: {
        type: "object",
        properties: {
          token_secret: {
            type: "string",
            description: "Optional. Secret name holding the bot token. Defaults to 'SLACK_BOT_TOKEN'.",
          },
          channel: { type: "string", description: "Channel ID (preferred) or #channel-name." },
          text: { type: "string" },
          thread_ts: { type: "string", description: "Optional. Reply in a thread." },
          blocks: { type: "array" },
        },
        required: ["channel", "text"],
      },
      invoke: async (ctx, args) => {
        const tokenName = typeof args.token_secret === "string" && args.token_secret
          ? args.token_secret
          : "SLACK_BOT_TOKEN";
        const token = await ctx.secret(tokenName);
        const body: Record<string, unknown> = {
          channel: args.channel,
          text: args.text,
        };
        if (typeof args.thread_ts === "string") body.thread_ts = args.thread_ts;
        if (Array.isArray(args.blocks)) body.blocks = args.blocks;
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string; channel?: string };
        if (!data.ok) {
          throw new Error(`Slack chat.postMessage failed: ${data.error ?? `HTTP ${res.status}`}`);
        }
        return { ok: true, ts: data.ts, channel: data.channel };
      },
    },
  ],
};
