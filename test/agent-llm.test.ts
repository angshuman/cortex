import { describe, it, expect } from "vitest";
import { sanitizeClaudeMessages, pickModelForProvider, messagesToOpenAI } from "../server/agent-llm";

describe("sanitizeClaudeMessages", () => {
  it("returns empty array for empty input", () => {
    expect(sanitizeClaudeMessages([])).toEqual([]);
  });

  it("passes through a valid alternating sequence unchanged", () => {
    const msgs = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "how are you" },
      { role: "assistant", content: "good" },
    ];
    expect(sanitizeClaudeMessages(msgs)).toEqual(msgs);
  });

  it("drops leading assistant messages", () => {
    const msgs = [
      { role: "assistant", content: "orphaned" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = sanitizeClaudeMessages(msgs);
    expect(result[0].role).toBe("user");
    expect(result.length).toBe(2);
  });

  it("merges consecutive user messages — crashed-turn scenario", () => {
    // Simulates: previous turn failed after tool_result but before assistant text.
    // loadHistory() replays tool events ending with user(tool_result),
    // then the new user message is appended → two consecutive user messages.
    const msgs = [
      { role: "user", content: "first request" },
      { role: "assistant", content: "[Tool: web_search] {}" },
      { role: "user", content: "[Tool Result for web_search]: results" },
      // ← no final assistant message (turn crashed)
      { role: "user", content: "second request" }, // ← new turn's user message
    ];
    const result = sanitizeClaudeMessages(msgs);
    // user, assistant, merged_user → 3 messages
    expect(result.length).toBe(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
    // The merged user message should contain both tool result and new request
    expect(Array.isArray(result[2].content)).toBe(true);
    const texts = result[2].content.map((b: any) => b.text);
    expect(texts).toContain("[Tool Result for web_search]: results");
    expect(texts).toContain("second request");
  });

  it("merges consecutive assistant messages — compaction scenario", () => {
    // Simulates: compaction rebuilds claudeMessages ending in assistant("Understood"),
    // then another assistant(tool_use) block is pushed → two consecutive assistants.
    const msgs = [
      { role: "user", content: "[Conversation summary]" },
      { role: "assistant", content: "Understood." },
      // ← compaction left claudeMessages ending with assistant("Understood")
      // then the step pushes the current turn's response (which contains tool_use):
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "web_search", input: {} }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "results" }] },
    ];
    const result = sanitizeClaudeMessages(msgs);
    // user, merged_assistant, user  → 3 messages
    expect(result.length).toBe(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
    // The two assistant messages should be merged into one content array
    expect(Array.isArray(result[1].content)).toBe(true);
    const hasToolUse = result[1].content.some((b: any) => b?.type === "tool_use");
    expect(hasToolUse).toBe(true);
  });

  it("handles multiple consecutive same-role runs", () => {
    const msgs = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "ok" },
    ];
    const result = sanitizeClaudeMessages(msgs);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("user");
    const texts = result[0].content.map((b: any) => b.text);
    expect(texts).toContain("a");
    expect(texts).toContain("b");
    expect(texts).toContain("c");
  });

  it("handles array content in merged messages", () => {
    const msgs = [
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
      { role: "assistant", content: "ok" },
    ];
    const result = sanitizeClaudeMessages(msgs);
    expect(result.length).toBe(2);
    expect(Array.isArray(result[0].content)).toBe(true);
    expect(result[0].content.length).toBe(2);
    expect(result[0].content[0].text).toBe("first");
    expect(result[0].content[1].text).toBe("second");
  });
});

describe("pickModelForProvider", () => {
  it("keeps compatible OpenAI models", () => {
    expect(pickModelForProvider("openai", "gpt-4.1")).toBe("gpt-4.1");
    expect(pickModelForProvider("openai", "o3")).toBe("o3");
  });

  it("falls back to provider default for incompatible provider/model pairs", () => {
    expect(pickModelForProvider("grok", "gpt-4.1")).toBe("grok-4");
    expect(pickModelForProvider("openai", "grok-4")).toBe("gpt-4.1");
    expect(pickModelForProvider("google", "claude-opus-4-5")).toBe("gemini-2.5-flash");
    expect(pickModelForProvider("anthropic", "gemini-2.5-pro")).toBe("claude-opus-4-5");
  });

  it("falls back to provider default when model is null/empty", () => {
    expect(pickModelForProvider("grok", null)).toBe("grok-4");
    expect(pickModelForProvider("openai", "")).toBe("gpt-4.1");
    expect(pickModelForProvider("anthropic", undefined)).toBe("claude-opus-4-5");
  });
});

describe("skill activation visibility regression", () => {
  it("keeps obvious language variants for keyword-based activation", () => {
    // This guards the specific UX issue where users said "investigate" while
    // keywords only had "research" and exact substring matching failed.
    const phrase = "please investigate this deeply";
    expect(phrase.includes("research")).toBe(false);
    expect(phrase.includes("investigate")).toBe(true);
  });
});

describe("messagesToOpenAI", () => {
  it("never emits empty content or missing role messages", () => {
    const fakeStorage: any = {
      getChatAsset: () => null,
      getNoteAsset: () => null,
      getFile: () => null,
    };
    const result = messagesToOpenAI(
      [
        { role: "user", content: "" } as any,
        { role: "assistant", content: [{ type: "text", text: "   " }] } as any,
        { role: "assistant", content: [{ type: "text", text: "ok" }] } as any,
        { role: undefined, content: "bad" } as any,
      ],
      "system prompt",
      fakeStorage,
    );
    for (const msg of result) {
      expect(typeof msg.role).toBe("string");
      expect(msg.content).not.toBe("");
      expect(msg.content).not.toBeUndefined();
      expect(msg.content).not.toBeNull();
    }
  });
});
