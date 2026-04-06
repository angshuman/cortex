import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { FileStorage } from "./storage";
import type { AgentSettings } from "@shared/schema";
import type { AgentMessage, ToolDef, EmitFn, AskUserFn } from "./agent-types";
import { resolveKey, supportsExtendedThinking, messagesToClaude, messagesToOpenAI, sanitizeClaudeMessages } from "./agent-llm";
import { executeTool } from "./agent-tools";
import { log, logError } from "./index";

const LLM_TIMEOUT_MS = 120_000; // 2 min hard timeout per LLM call

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
  askUserFn?: AskUserFn,
): Promise<void> {
  if (provider === "anthropic") {
    await runClaude(systemPrompt, tools, model, messages, storage, agentSettings, emit, compactContext, askUserFn);
  } else {
    await runOpenAI(systemPrompt, tools, model, provider, messages, storage, agentSettings, emit, compactContext, askUserFn);
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
  askUserFn?: AskUserFn,
): Promise<void> {
  const client = new Anthropic({ apiKey: resolveKey("anthropic"), timeout: LLM_TIMEOUT_MS });
  log(`[agent] claude loop start — model=${model} maxTurns=${agentSettings.maxTurns}`);

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
      messages: claudeMessages, // sanitized just before stream call below
      tools: claudeTools.length > 0 ? claudeTools : undefined,
    };

    if (useThinking) {
      // Extended thinking: Claude reasons before acting. Temperature must not be set.
      params.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    } else if (agentSettings.temperature !== undefined) {
      params.temperature = agentSettings.temperature;
    }

    // ── Think (streaming) ──────────────────────────────────────────────────
    log(`[agent] claude step=${step} calling LLM (stream)`);
    // Sanitize before every call: enforce user↔assistant alternation,
    // merge consecutive same-role messages that can arise from crashed turns or compaction.
    const sanitized = sanitizeClaudeMessages(claudeMessages);
    const stream = client.messages.stream({ ...params, messages: sanitized } as any);

    // Forward text deltas to the client in real-time
    stream.on("text", (chunk) => emit("delta", chunk));

    // Await the complete response (stream.finalMessage() resolves after all chunks)
    const response = await stream.finalMessage();
    log(`[agent] claude step=${step} stream done stop_reason=${response.stop_reason}`);

    if ((response as any).usage) {
      const u = (response as any).usage;
      storage.addTokenUsage(u.input_tokens || 0, u.output_tokens || 0);
      const compacted = await compactContext(u.input_tokens || 0, "anthropic");
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
        log(`[agent] claude tool=${toolBlock.name}`);
        emit("tool_call", JSON.stringify({ name: toolBlock.name, args: toolBlock.input }), { tool: toolBlock.name });

        // ask_clarification — pause loop and await user response
        if (toolBlock.name === "ask_clarification") {
          const question = (toolBlock.input as any).question as string;
          const choices = (toolBlock.input as any).choices as string[] | undefined;
          const answer = askUserFn
            ? await askUserFn(question, choices)
            : "(No user available to answer)";
          emit("tool_result", answer, { tool: toolBlock.name });
          toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: answer });
          messages.push({ role: "assistant", content: `[Tool: ask_clarification] ${JSON.stringify(toolBlock.input)}` });
          messages.push({ role: "user", content: `[User answered]: ${answer}` });
          continue;
        }

        try {
          const result = await executeTool(toolBlock.name, toolBlock.input as Record<string, any>, storage, agentSettings);
          emit("tool_result", result, { tool: toolBlock.name });
          toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result });
          messages.push({ role: "assistant", content: `[Tool: ${toolBlock.name}] ${JSON.stringify(toolBlock.input)}` });
          messages.push({ role: "user", content: `[Tool Result for ${toolBlock.name}]: ${result}` });
        } catch (toolErr: any) {
          logError(`[agent] claude tool=${toolBlock.name} failed`, toolErr);
          const errMsg = JSON.stringify({ error: toolErr.message ?? String(toolErr) });
          emit("tool_result", errMsg, { tool: toolBlock.name });
          toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: errMsg });
          messages.push({ role: "assistant", content: `[Tool: ${toolBlock.name}] ${JSON.stringify(toolBlock.input)}` });
          messages.push({ role: "user", content: `[Tool Result for ${toolBlock.name}]: ${errMsg}` });
        }
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
  askUserFn?: AskUserFn,
): Promise<void> {
  const config: any = { timeout: LLM_TIMEOUT_MS };
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
  log(`[agent] openai loop start — provider=${provider} model=${model} maxTurns=${agentSettings.maxTurns}`);

  const openaiTools: any[] = tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const openaiMessages: any[] = messagesToOpenAI(messages, systemPrompt, storage);

  let step = 0;
  let loopCompleted = false;
  while (step < agentSettings.maxTurns) {
    step++;

    // ── Think (streaming) ──────────────────────────────────────────────────
    log(`[agent] openai step=${step} calling LLM (stream)`);

    const streamParams: any = {
      model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      max_tokens: agentSettings.maxTokens,
      ...(agentSettings.temperature !== undefined ? { temperature: agentSettings.temperature } : {}),
      stream: true,
      stream_options: { include_usage: true },
    };

    const stream = await client.chat.completions.create(streamParams);

    let fullText = "";
    let finishReason = "";
    const toolCallAccum: Record<number, any> = {};
    let streamUsage: any = null;

    for await (const chunk of stream as any) {
      const delta = chunk.choices?.[0]?.delta;
      const fr = chunk.choices?.[0]?.finish_reason;
      if (fr) finishReason = fr;
      if (chunk.usage) streamUsage = chunk.usage;
      if (!delta) continue;

      if (delta.content) {
        fullText += delta.content;
        emit("delta", delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? 0;
          if (!toolCallAccum[idx]) {
            toolCallAccum[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
          }
          if (tc.id) toolCallAccum[idx].id = tc.id;
          if (tc.function?.name) toolCallAccum[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallAccum[idx].function.arguments += tc.function.arguments;
        }
      }
    }

    log(`[agent] openai step=${step} stream done finish_reason=${finishReason}`);

    if (streamUsage) {
      storage.addTokenUsage(streamUsage.prompt_tokens || 0, streamUsage.completion_tokens || 0);
      await compactContext(streamUsage.prompt_tokens || 0, provider);
    }

    const toolCallsList = Object.values(toolCallAccum);
    // Synthetic message object matching the non-streaming shape
    const msg: any = {
      content: fullText || null,
      tool_calls: toolCallsList.length > 0 ? toolCallsList : undefined,
    };

    // ── Act + Observe ──────────────────────────────────────────────────────
    if (msg.tool_calls?.length > 0) {
      openaiMessages.push(msg);
      if (msg.content) emit("thought", msg.content);

      for (const tc of msg.tool_calls) {
        const fn = tc.function;
        let args: Record<string, any>;
        try { args = JSON.parse(fn.arguments); } catch { args = {}; }

        log(`[agent] openai tool=${fn.name}`);
        emit("tool_call", JSON.stringify({ name: fn.name, args }), { tool: fn.name });

        // ask_clarification — pause loop and await user response
        if (fn.name === "ask_clarification") {
          const answer = askUserFn
            ? await askUserFn(args.question as string, args.choices as string[] | undefined)
            : "(No user available to answer)";
          emit("tool_result", answer, { tool: fn.name });
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: answer });
          messages.push({ role: "assistant", content: `[Tool: ask_clarification] ${fn.arguments}` });
          messages.push({ role: "user", content: `[User answered]: ${answer}` });
          continue;
        }

        try {
          const result = await executeTool(fn.name, args, storage, agentSettings);
          emit("tool_result", result, { tool: fn.name });
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
          messages.push({ role: "assistant", content: `[Tool: ${fn.name}] ${fn.arguments}` });
          messages.push({ role: "user", content: `[Tool Result for ${fn.name}]: ${result}` });
        } catch (toolErr: any) {
          logError(`[agent] openai tool=${fn.name} failed`, toolErr);
          const errMsg = JSON.stringify({ error: toolErr.message ?? String(toolErr) });
          emit("tool_result", errMsg, { tool: fn.name });
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: errMsg });
          messages.push({ role: "assistant", content: `[Tool: ${fn.name}] ${fn.arguments}` });
          messages.push({ role: "user", content: `[Tool Result for ${fn.name}]: ${errMsg}` });
        }
      }
      continue; // loop back to Think
    }

    // Model produced text with no tool calls — done
    if (msg.content) {
      emit("message", msg.content, { role: "assistant" });
      messages.push({ role: "assistant", content: msg.content });
      openaiMessages.push({ role: "assistant", content: msg.content });
    } else {
      logError(`[agent] openai step=${step} finish_reason=${finishReason} — empty response, no tool calls`);
    }
    loopCompleted = true;
    break;
  }

  if (!loopCompleted) {
    emit("message", "*(Reached the maximum number of steps. The task may be incomplete.)*", { role: "assistant" });
  }
}
