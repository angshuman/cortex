import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { FileStorage } from "./storage";
import type { AgentSettings } from "@shared/schema";
import { logError } from "./index";


// ── Provider detection ────────────────────────────────────────────────────────

export function detectProvider(): { provider: string; model: string } {
  try {
    const { vaultManager } = require("./storage");
    if (vaultManager) {
      const ak = vaultManager.resolveApiKey("anthropic");
      const ok = vaultManager.resolveApiKey("openai");
      const gk = vaultManager.resolveApiKey("grok");
      const goog = vaultManager.resolveApiKey("google");
      if (ak && ak.length > 10) return { provider: "anthropic", model: "claude-opus-4-5" };
      if (ok && ok.length > 10) return { provider: "openai", model: "gpt-4.1" };
      if (gk && gk.length > 10) return { provider: "grok", model: "grok-4" };
      if (goog && goog.length > 10) return { provider: "google", model: "gemini-2.5-flash" };
    }
  } catch {}
  const ak = process.env.ANTHROPIC_API_KEY;
  const ok = process.env.OPENAI_API_KEY;
  const gk = process.env.GROK_API_KEY;
  const goog = process.env.GOOGLE_API_KEY;
  if (ak && ak.length > 10) return { provider: "anthropic", model: "claude-opus-4-5" };
  if (ok && ok.length > 10) return { provider: "openai", model: "gpt-4.1" };
  if (gk && gk.length > 10) return { provider: "grok", model: "grok-4" };
  if (goog && goog.length > 10) return { provider: "google", model: "gemini-2.5-flash" };
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
  return messages
    .filter(m => m.role !== "system")
    .map(m => {
      if (typeof m.content === "string") {
        return { role: m.role as "user" | "assistant", content: m.content };
      }
      const parts: any[] = [];
      for (const block of m.content) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          const data = imageUrlToBase64(block.url, storage);
          if (data) {
            parts.push({
              type: "image",
              source: { type: "base64", media_type: data.mediaType, data: data.base64 },
            });
          }
        }
      }
      return { role: m.role as "user" | "assistant", content: parts.length > 0 ? parts : "" };
    });
}

/** Convert AgentMessage[] to the OpenAI messages format (also used by Grok/Google). */
export function messagesToOpenAI(messages: AgentMessage[], systemPrompt: string, storage: FileStorage): any[] {
  const result: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      result.push({ role: m.role, content: m.content });
    } else {
      const parts: any[] = [];
      for (const block of m.content) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
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
      result.push({ role: m.role, content: parts.length > 0 ? parts : "" });
    }
  }
  return result;
}
