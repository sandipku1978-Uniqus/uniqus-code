import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  normalizeMessageHistory,
  sanitizeMessagesForPersistence,
} from "./messageHistory.js";

// normalizeMessageHistory must keep history replayable on Anthropic, which 400s
// on a non-final empty-content assistant message. OpenAI/Gemini can persist
// content:[] on a refusal / all-thinking / blocked turn; an old session that
// stored one would brick every later replay until repaired here (C-9 part b).

describe("normalizeMessageHistory · empty assistant repair (C-9)", () => {
  it("replaces an empty-array assistant content with a placeholder text block", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [] },
      { role: "user", content: "still there?" },
    ];

    const out = normalizeMessageHistory(messages);

    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "(no response)" }],
    });
  });

  it("repairs an empty/whitespace string assistant content too", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "   " },
    ];

    const out = normalizeMessageHistory(messages);

    expect(out[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "(no response)" }],
    });
  });

  it("leaves a non-empty assistant message untouched", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];

    const out = normalizeMessageHistory(messages);
    expect(out[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("does not leave a dangling tool_use pending when the assistant turn is empty", () => {
    // An empty assistant turn carries no tool_use, so the following user turn
    // must not be rewritten into recovery results.
    const messages: Anthropic.MessageParam[] = [
      { role: "assistant", content: [] },
      { role: "user", content: "next" },
    ];

    const out = normalizeMessageHistory(messages);
    expect(out).toEqual([
      { role: "assistant", content: [{ type: "text", text: "(no response)" }] },
      { role: "user", content: "next" },
    ]);
  });
});

describe("sanitizeMessagesForPersistence", () => {
  it("removes tool-result base64 while preserving replay path text and live context", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "shot-1",
            content: [
              {
                type: "text",
                text: "Screenshot saved to assets/screenshots/home.png",
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "very-large-live-base64",
                },
              },
            ],
          },
        ],
      },
    ];

    const persisted = sanitizeMessagesForPersistence(messages);

    expect(JSON.stringify(persisted)).not.toContain("very-large-live-base64");
    expect(JSON.stringify(persisted)).toContain("assets/screenshots/home.png");
    expect(JSON.stringify(messages)).toContain("very-large-live-base64");
    expect(persisted).not.toBe(messages);
    expect(persisted[0]).not.toBe(messages[0]);
  });

  it("uses a small recovery stub when an image was the whole tool result", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "shot-2",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "pixels",
                },
              },
            ],
          },
        ],
      },
    ];

    const persisted = sanitizeMessagesForPersistence(messages);
    expect(persisted[0]).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "shot-2",
          content: [{ type: "text", text: expect.stringContaining("screenshot omitted") }],
        },
      ],
    });
  });
});
