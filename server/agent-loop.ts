import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { FileStorage } from "./storage";
import type { AgentSettings } from "@shared/schema";
import type { AgentMessage, ToolDef, EmitFn } from "./agent-types";
import { resolveKey, supportsExtendedThinking, messagesToClaude, messagesToOpenAI } from "./agent-llm";
import { executeTool } from "./agent-tools";

/**
 * The agentic loop — Think → Act → Observe, repeated until the model stops calling tools.
 *
 * Dispatches to the appropriate provider implementation. Both follow the same pattern:
 *  1. Call the LLM (with tools registered)
 *  2. If the model emits reasoning/thinking, stream it as "thought" events
 *  3. If the model calls tools, execute them and feed results back — then loop
 *  4. When the model produces text with no tool calls, emit it as the final "message"
 *
 * `messages` is the persistent history (simplified strings for session replay).
 * Each provider maintains its own live conversation format internally.
 */
export async function runAgentLoop(
  provider: string,
  model: string,
  systemPrompt: string,
  tools: ToolDef[],
  messages: AgentMessage[],
  storage: FileStorage,
  agentSettings: AgentSettings,
  emit: EmitFn,
  compactContext: (inputTokens: number, provider: string) => Promise<boolean>,
): Promise<void> {
  if (provider === "claude") {
    await runClaude(systemPrompt, tools, model, messages, storage, agentSettings, emit, compactContext);
  } else {
    await runOpenAI(systemPrompt, tools, model, provider, messages, storage, agentSettings, emit, compactContext);
  }
}

// ── Claude ────────────────────────────────────────────────────────────────────

async function runClaude(
  systemPrompt: string,
  tools: ToolDef[],
  model: string,
  messages: AgentMessage[],
  storage: FileStorage,
  agentSettings: AgentSettings,
  emit: EmitFn,
  compactContext: (inputTokens: number, provider: string) => Promise<boolean>,
): Promise<void> {
  const client = new Anthropic({ apiKey: resolveKey("anthropic") });

  const claudeTools: any[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  // Native Claude-format conversation kept separate from `messages` so that thinking
  // blocks survive across loop iterations. Anthropic requires them to be echoed back.
  const claudeMessages: any[] = messagesToClaude(messages, storage);

  const useThinking = supportsExtendedThinking(model);
  const thinkingBudget = 8000;
  const maxTokens = useThinking
    ? Math.max(agentSettings.maxTokens, thinkingBudget + 8192)
    : agentSettings.maxTokens;

  let step = 0;
  let loopCompleted = false;
  while (step < agentSettings.maxTurns) {
    step++;

    const params: any = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: claudeMessages,
      tools: claudeTools.length > 0 ? claudeTools : undefined,
    };

    if (useThinking) {
      // Extended thinking: Claude reasons before acting. Temperature must not be set.
      params.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    } else if (agentSettings.temperature !== undefined) {
      params.temperature = agentSettings.temperature;
    }

    // ── Think ──────────────────────────────────────────────────────────────
    const response = await client.messages.create(params as any);

    if ((response as any).usage) {
      const u = (response as any).usage;
      storage.addTokenUsage(u.input_tokens || 0, u.output_tokens || 0);
      const compacted = await compactContext(u.input_tokens || 0, "claude");
      if (compacted) {
        claudeMessages.length = 0;
        claudeMessages.push(...messagesToClaude(messages, storage));
      }
    }

    let hasToolUse = false;
    let textContent = "";
    const toolUseBlocks: any[] = [];

    for (const block of response.content) {
      if (block.type === "thinking") {
        // Stream internal reasoning to the UI (trimmed for readability)
        const raw: string = (block as any).thinking || "";
        const preview = raw.length > 500 ? raw.slice(0, 500) + "…" : raw;
        if (preview.trim()) emit("thought", preview);
      } else if (block.type === "text") {
        textContent += (block as any).text;
      } else if (block.type === "tool_use") {
        hasToolUse = true;
        toolUseBlocks.push(block);
      }
    }

    // ── Act + Observe ──────────────────────────────────────────────────────
    if (hasToolUse) {
      if (textContent) emit("thought", textContent);

      const toolResults: any[] = [];
      for (const toolBlock of toolUseBlocks) {
        emit("tool_call", JSON.stringify({ name: toolBlock.name, args: toolBlock.input }), { tool: toolBlock.name });
        const result = await executeTool(toolBlock.name, toolBlock.input as Record<string, any>, storage, agentSettings);
        emit("tool_result", result, { tool: toolBlock.name });
        toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result });
        messages.push({ role: "assistant", content: `[Tool: ${toolBlock.name}] ${JSON.stringify(toolBlock.input)}` });
        messages.push({ role: "user", content: `[Tool Result for ${toolBlock.name}]: ${result}` });
      }

      // Full content (including thinking blocks) must be preserved — Anthropic requirement
      claudeMessages.push({ role: "assistant", content: response.content });
      claudeMessages.push({ role: "user", content: toolResults });
      continue; // loop back to Think
    }

    // Model produced text with no tool calls — done
    if (textContent) {
      emit("message", textContent, { role: "assistant" });
      messages.push({ role: "assistant", content: textContent });
    }
    loopCompleted = true;
    break;
  }

  if (!loopCompleted) {
    emit("message", "*(Reached the maximum number of steps. The task may be incomplete.)*", { role: "assistant" });
  }
}

// ── OpenAI / Grok / Google ────────────────────────────────────────────────────

async function runOpenAI(
  systemPrompt: string,
  tools: ToolDef[],
  model: string,
  provider: string,
  messages: AgentMessage[],
  storage: FileStorage,
  agentSettings: AgentSettings,
  emit: EmitFn,
  compactContext: (inputTokens: number, provider: string) => Promise<boolean>,
): Promise<void> {
  const config: any = {};
  if (provider === "grok") {
    config.baseURL = "https://api.x.ai/v1";
    config.apiKey = resolveKey("grok");
  } else if (provider === "google") {
    config.baseURL = "https://generativelanguage.googleapis.com/v1beta/openai";
    config.apiKey = resolveKey("google");
  } else {
    const key = resolveKey("openai");
    if (key) config.apiKey = key;
  }
  const client = new OpenAI(config);

  const openaiTools: any[] = tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const openaiMessages: any[] = messagesToOpenAI(messages, systemPrompt, storage);

  let step = 0;
  let loopCompleted = false;
  while (step < agentSettings.maxTurns) {
    step++;
    emit("thought", step === 1 ? "Thinking..." : `Working... (step ${step})`);

    // ── Think ──────────────────────────────────────────────────────────────
    const response = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      max_tokens: agentSettings.maxTokens,
      ...(agentSettings.temperature !== undefined ? { temperature: agentSettings.temperature } : {}),
    } as any);

    if (response.usage) {
      storage.addTokenUsage(response.usage.prompt_tokens || 0, response.usage.completion_tokens || 0);
      await compactContext(response.usage.prompt_tokens || 0, provider);
    }

    const msg: any = response.choices[0].message;

    // ── Act + Observe ──────────────────────────────────────────────────────
    if (msg.tool_calls?.length > 0) {
      openaiMessages.push(msg);
      if (msg.content) emit("thought", msg.content);

      for (const tc of msg.tool_calls) {
        const fn = tc.function;
        let args: Record<string, any>;
        try { args = JSON.parse(fn.arguments); } catch { args = {}; }

        emit("tool_call", JSON.stringify({ name: fn.name, args }), { tool: fn.name });
        const result = await executeTool(fn.name, args, storage, agentSettings);
        emit("tool_result", result, { tool: fn.name });
        openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
        messages.push({ role: "assistant", content: `[Tool: ${fn.name}] ${fn.arguments}` });
        messages.push({ role: "user", content: `[Tool Result for ${fn.name}]: ${result}` });
      }
      continue; // loop back to Think
    }

    // Model produced text with no tool calls — done
    if (msg.content) {
      emit("message", msg.content, { role: "assistant" });
      messages.push({ role: "assistant", content: msg.content });
      openaiMessages.push({ role: "assistant", content: msg.content });
    }
    loopCompleted = true;
    break;
  }

  if (!loopCompleted) {
    emit("message", "*(Reached the maximum number of steps. The task may be incomplete.)*", { role: "assistant" });
  }
}
