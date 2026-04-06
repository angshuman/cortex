import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { FileStorage } from "./storage";
import type { AgentSettings } from "@shared/schema";
import { logError } from "./index";


// ── Provider detection ────────────────────────────────────────────────────────

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-opus-4-5",
  openai: "gpt-4.1",
  grok: "grok-4",
  google: "gemini-2.5-flash",
};

function isModelCompatibleWithProvider(provider: string, model?: string | null): boolean {
  if (!model) return false;
  if (provider === "anthropic") return model.startsWith("claude-");
  if (provider === "openai") return model.startsWith("gpt-") || /^o\d/.test(model);
  if (provider === "grok") return model.startsWith("grok-");
  if (provider === "google") return model.startsWith("gemini-");
  return false;
}

export function pickModelForProvider(provider: string, requestedModel?: string | null): string {
  if (isModelCompatibleWithProvider(provider, requestedModel)) return requestedModel!;
  return PROVIDER_DEFAULT_MODELS[provider] || "unknown";
}

export function detectProvider(): { provider: string; model: string } {
  try {
    const { vaultManager } = require("./storage");
    if (vaultManager) {
      const config = vaultManager.getConfig();

      // Respect explicit provider preference saved by the user
      const explicitProvider = config?.aiProvider as string | undefined;
      const explicitModel = config?.aiModel as string | null | undefined;

      if (explicitProvider && explicitProvider !== "none") {
        const key = vaultManager.resolveApiKey(explicitProvider);
        if (key && key.length > 10) {
          return {
            provider: explicitProvider,
            model: pickModelForProvider(explicitProvider, explicitModel),
          };
        }
      }

      // No explicit preference — pick the first available key
      const ak = vaultManager.resolveApiKey("anthropic");
      const ok = vaultManager.resolveApiKey("openai");
      const gk = vaultManager.resolveApiKey("grok");
      const goog = vaultManager.resolveApiKey("google");
      if (ak && ak.length > 10) return { provider: "anthropic", model: pickModelForProvider("anthropic", explicitModel) };
      if (ok && ok.length > 10) return { provider: "openai", model: pickModelForProvider("openai", explicitModel) };
      if (gk && gk.length > 10) return { provider: "grok", model: pickModelForProvider("grok", explicitModel) };
      if (goog && goog.length > 10) return { provider: "google", model: pickModelForProvider("google", explicitModel) };
    }
  } catch {}

  // Fall back to environment variables
  const envModel = ""; // no model override from env
  const ak = process.env.ANTHROPIC_API_KEY;
  const ok = process.env.OPENAI_API_KEY;
  const gk = process.env.GROK_API_KEY;
  const goog = process.env.GOOGLE_API_KEY;
  if (ak && ak.length > 10) return { provider: "anthropic", model: PROVIDER_DEFAULT_MODELS.anthropic };
  if (ok && ok.length > 10) return { provider: "openai", model: PROVIDER_DEFAULT_MODELS.openai };
  if (gk && gk.length > 10) return { provider: "grok", model: PROVIDER_DEFAULT_MODELS.grok };
  if (goog && goog.length > 10) return { provider: "google", model: PROVIDER_DEFAULT_MODELS.google };
  return { provider: "none", model: "none" };
}

export function resolveKey(provider: "openai" | "anthropic" | "grok" | "google"): string {
  try {
    const { vaultManager } = require("./storage");
    if (vaultManager) return vaultManager.resolveApiKey(provider);
  } catch {}
  const envMap: Record<string, string> = {
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    grok: process.env.GROK_API_KEY || "",
    google: process.env.GOOGLE_API_KEY || "",
  };
  return envMap[provider] || "";
}

// ── Lightweight LLM helper ────────────────────────────────────────────────────

/**
 * Single-turn LLM call that expects a JSON response.
 * Used for intent extraction, context compaction titles, and auto-titling.
 */
export async function callLLMJson(systemPrompt: string, userPrompt: string, maxTokens = 800): Promise<Record<string, any> | null> {
  const { provider, model } = detectProvider();
  if (provider === "none") return null;
  try {
    let text = "";
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey: resolveKey("anthropic") });
      const resp = await client.messages.create({
        model, max_tokens: maxTokens, temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      } as any);
      text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    } else {
      const config: any = {};
      if (provider === "grok") { config.baseURL = "https://api.x.ai/v1"; config.apiKey = resolveKey("grok"); }
      else if (provider === "google") { config.baseURL = "https://generativelanguage.googleapis.com/v1beta/openai"; config.apiKey = resolveKey("google"); }
      else { const k = resolveKey("openai"); if (k) config.apiKey = k; }
      const client = new OpenAI(config);
      const resp = await client.chat.completions.create({
        model, max_tokens: maxTokens, temperature: 0.3,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      } as any);
      text = resp.choices[0]?.message?.content || "";
    }
    const clean = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(clean);
  } catch (err: any) {
    logError("[LLM] callLLMJson failed", err);
    return null;
  }
}

// ── Claude support ────────────────────────────────────────────────────────────

/** Models that support extended thinking (Claude 3.7+ and Opus/Sonnet 4). */
export function supportsExtendedThinking(model: string): boolean {
  return (
    model.startsWith("claude-3-7") ||
    model.startsWith("claude-opus-4") ||
    model.startsWith("claude-sonnet-4")
  );
}

export function imageUrlToBase64(url: string, storage: FileStorage): { base64: string; mediaType: string } | null {
  try {
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
    };

    const chatMatch = url.match(/\/api\/chat\/assets\/(.+)$/);
    if (chatMatch) {
      const buf = storage.getChatAsset(chatMatch[1]);
      if (!buf) return null;
      const ext = chatMatch[1].split(".").pop()?.toLowerCase() || "png";
      return { base64: buf.toString("base64"), mediaType: mimeMap[ext] || "image/png" };
    }

    const noteMatch = url.match(/\/api\/notes\/([^/]+)\/assets\/(.+)$/);
    if (noteMatch) {
      const buf = storage.getNoteAsset(noteMatch[1], noteMatch[2]);
      if (!buf) return null;
      const ext = noteMatch[2].split(".").pop()?.toLowerCase() || "png";
      return { base64: buf.toString("base64"), mediaType: mimeMap[ext] || "image/png" };
    }

    const fileMatch = url.match(/\/api\/files\/([^/]+)\//);
    if (fileMatch) {
      const fileData = storage.getFile(fileMatch[1]);
      if (!fileData) return null;
      const ext = fileData.name.split(".").pop()?.toLowerCase() || "png";
      return { base64: fileData.buffer.toString("base64"), mediaType: mimeMap[ext] || "image/png" };
    }

    return null;
  } catch {
    return null;
  }
}

/** Convert AgentMessage[] to the native Claude messages format. */
export function messagesToClaude(messages: AgentMessage[], storage: FileStorage): any[] {
  const result: any[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (!m.role) continue; // guard: skip messages with missing role

    let content: any;
    if (typeof m.content === "string") {
      // Empty string content is rejected by the Anthropic API — replace with a placeholder
      content = m.content.trim() ? m.content : "(empty)";
    } else {
      const parts: any[] = [];
      for (const block of m.content) {
        if (block.type === "text") {
          if (block.text?.trim()) parts.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          const data = imageUrlToBase64(block.url, storage);
          if (data) {
            parts.push({
              type: "image",
              source: { type: "base64", media_type: data.mediaType, data: data.base64 },
            });
          }
        }
        // other block types (note, task, etc.) are not sent to the LLM
      }
      // Never send empty content — Anthropic rejects it and reports 'messages[N].role missing'
      content = parts.length > 0 ? parts : [{ type: "text", text: "(empty)" }];
    }

    result.push({ role: m.role as "user" | "assistant", content });
  }
  return sanitizeClaudeMessages(result);
}

/**
 * Ensure the message array satisfies Anthropic's strict alternation requirement:
 *   - Must start with a user message
 *   - Must strictly alternate user ↔ assistant
 *
 * Consecutive same-role messages arise from:
 *   1. Crashed turns: previous turn failed after tool calls but before final assistant
 *      text → history ends with user(tool_result), new user message creates user+user
 *   2. Compaction mid-turn: claudeMessages is rebuilt ending in "assistant", then the
 *      current step appends another assistant(tool_use) → assistant+assistant
 *
 * Fix: merge consecutive same-role messages by combining their content arrays.
 * Also drop leading assistant messages (conversation must start with user).
 */
export function sanitizeClaudeMessages(messages: any[]): any[] {
  if (messages.length === 0) return messages;

  // Normalise a content value to an array of content blocks
  const toBlocks = (c: any): any[] => {
    if (Array.isArray(c)) return c;
    if (typeof c === "string" && c) return [{ type: "text", text: c }];
    return [{ type: "text", text: "(empty)" }];
  };

  // Drop leading assistant messages — Claude requires user to go first
  let start = 0;
  while (start < messages.length && messages[start].role !== "user") start++;

  const merged: any[] = [];
  for (let i = start; i < messages.length; i++) {
    const msg = messages[i];
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      // Merge into the previous message
      merged[merged.length - 1] = {
        role: prev.role,
        content: [...toBlocks(prev.content), ...toBlocks(msg.content)],
      };
    } else {
      merged.push({ role: msg.role, content: msg.content });
    }
  }

  return merged;
}

/** Convert AgentMessage[] to the OpenAI messages format (also used by Grok/Google). */
export function messagesToOpenAI(messages: AgentMessage[], systemPrompt: string, storage: FileStorage): any[] {
  const result: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (!m?.role || (m.role !== "user" && m.role !== "assistant" && m.role !== "system")) continue;
    if (typeof m.content === "string") {
      result.push({ role: m.role, content: m.content.trim() ? m.content : "(empty)" });
    } else {
      const parts: any[] = [];
      for (const block of m.content) {
        if (block.type === "text") {
          if (block.text?.trim()) parts.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          const data = imageUrlToBase64(block.url, storage);
          if (data) {
            parts.push({
              type: "image_url",
              image_url: { url: `data:${data.mediaType};base64,${data.base64}` },
            });
          }
        }
      }
      result.push({ role: m.role, content: parts.length > 0 ? parts : "(empty)" });
    }
  }
  return result;
}
