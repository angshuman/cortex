import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { v4 as uuid } from "uuid";
import { storage } from "./storage";
import type { ChatEvent, Skill } from "@shared/schema";

type EventCallback = (event: ChatEvent) => void;

interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

function detectProvider(): { provider: string; model: string } {
  const ak = process.env.ANTHROPIC_API_KEY;
  const ok = process.env.OPENAI_API_KEY;
  const gk = process.env.GROK_API_KEY;
  if (ak && ak.length > 10) return { provider: "claude", model: "claude-sonnet-4-20250514" };
  if (ok && ok.length > 10) return { provider: "openai", model: "gpt-4o" };
  if (gk && gk.length > 10) return { provider: "grok", model: "grok-3" };
  return { provider: "none", model: "none" };
}

function getToolDefinitions(): ToolDef[] {
  const skills = storage.getSkills().filter((s: Skill) => s.enabled);
  const tools: ToolDef[] = [];
  for (const skill of skills) {
    for (const tool of skill.tools) {
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const p of tool.parameters) {
        properties[p.name] = {
          type: p.type === "string[]" ? "array" : "string",
          description: p.description,
        };
        if (p.type === "string[]") properties[p.name].items = { type: "string" };
        if (p.required) required.push(p.name);
      }
      tools.push({
        name: tool.name,
        description: `[${skill.name}] ${tool.description}`,
        parameters: { type: "object" as const, properties, required },
      });
    }
  }
  return tools;
}

async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  try {
    switch (name) {
      case "create_note": {
        const note = storage.createNote({
          title: args.title || "Untitled",
          content: args.content || "",
          folder: args.folder,
          tags: args.tags,
        });
        return JSON.stringify({ success: true, note: { id: note.id, title: note.title } });
      }
      case "read_note": {
        const note = storage.getNote(args.id);
        if (!note) return JSON.stringify({ error: "Note not found" });
        return JSON.stringify(note);
      }
      case "list_notes": {
        let notes = storage.getNotes();
        if (args.folder) notes = notes.filter((n: any) => n.folder === args.folder || n.folder.startsWith(args.folder + "/"));
        return JSON.stringify(notes.map((n: any) => ({ id: n.id, title: n.title, folder: n.folder, updatedAt: n.updatedAt })));
      }
      case "update_note": {
        const updates: any = {};
        if (args.title) updates.title = args.title;
        if (args.content) updates.content = args.content;
        const note = storage.updateNote(args.id, updates);
        if (!note) return JSON.stringify({ error: "Note not found" });
        return JSON.stringify({ success: true, note: { id: note.id, title: note.title } });
      }
      case "create_task": {
        const task = storage.createTask({
          title: args.title || "Untitled Task",
          description: args.description,
          priority: args.priority,
          parentId: args.parentId,
          dueDate: args.dueDate,
        });
        return JSON.stringify({ success: true, task: { id: task.id, title: task.title } });
      }
      case "list_tasks": {
        let tasks = storage.getTasks();
        if (args.status) tasks = tasks.filter((t: any) => t.status === args.status);
        return JSON.stringify(tasks.map((t: any) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })));
      }
      case "update_task": {
        const upd: any = {};
        if (args.status) upd.status = args.status;
        if (args.title) upd.title = args.title;
        if (args.priority) upd.priority = args.priority;
        const task = storage.updateTask(args.id, upd);
        if (!task) return JSON.stringify({ error: "Task not found" });
        return JSON.stringify({ success: true, task: { id: task.id, title: task.title, status: task.status } });
      }
      case "complete_task": {
        const task = storage.updateTask(args.id, { status: "done" });
        if (!task) return JSON.stringify({ error: "Task not found" });
        return JSON.stringify({ success: true, task: { id: task.id, title: task.title, status: "done" } });
      }
      case "web_search": {
        const query = args.query || "";
        try {
          // Use HackerNews Algolia API as a built-in search source
          const searchUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`;
          const resp = await fetch(searchUrl);
          if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
          const data = await resp.json() as any;
          const results = (data.hits || []).map((h: any) => ({
            title: h.title,
            url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
            points: h.points,
            author: h.author,
            date: h.created_at,
            comments: h.num_comments,
            hnUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
          }));
          return JSON.stringify({ source: "Hacker News", results });
        } catch (err: any) {
          return JSON.stringify({ error: `Search failed: ${err.message}` });
        }
      }
      case "web_fetch": {
        const url = args.url || "";
        try {
          const resp = await fetch(url, {
            headers: { "User-Agent": "Cortex/1.0", "Accept": "application/json, text/html, */*" },
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
          const contentType = resp.headers.get("content-type") || "";
          let body: string;
          if (contentType.includes("json")) {
            body = JSON.stringify(await resp.json(), null, 2);
          } else {
            body = await resp.text();
          }
          // Truncate very large responses
          if (body.length > 15000) body = body.slice(0, 15000) + "\n... (truncated)";
          return JSON.stringify({ url, contentType, body });
        } catch (err: any) {
          return JSON.stringify({ error: `Fetch failed: ${err.message}` });
        }
      }
      case "browser_navigate":
      case "browser_screenshot":
      case "browser_click":
      case "browser_type":
      case "browser_snapshot":
        return JSON.stringify({ info: "Browser MCP available when Playwright MCP server is configured." });
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

function buildSystemPrompt(): string {
  const skills = storage.getSkills().filter((s: Skill) => s.enabled);
  const skillInstructions = skills.map((s: Skill) => s.instructions).filter(Boolean).join("\n\n");
  const notes = storage.getNotes();
  const tasks = storage.getTasks().filter((t: any) => t.status !== "archived");
  const taskSummary = tasks.length > 0
    ? `Current tasks:\n${tasks.slice(0, 15).map((t: any) => `- [${t.status}] ${t.title} (${t.priority})`).join("\n")}`
    : "No active tasks.";
  const notesSummary = notes.length > 0
    ? `Notes available:\n${notes.slice(0, 15).map((n: any) => `- "${n.title}" in ${n.folder}`).join("\n")}`
    : "No notes yet.";

  return `You are Cortex, a personal AI operating system assistant. You are a reasoner, planner, and note-taker.

## Your Capabilities
- Create, read, update, and organize notes (markdown with image support)
- Create, manage, and track tasks and subtasks
- Browse the web using browser tools (when MCP is configured)
- Search across all notes, tasks, and conversations
- Plan and reason through complex problems step by step

## Current Context
${taskSummary}

${notesSummary}

## How You Think
When given a complex request:
1. First, think about the problem and share your reasoning
2. Break it down into steps if needed
3. Use your tools to take action
4. Summarize what you did

Always be concise but thorough. Use markdown formatting in responses.

${skillInstructions}`;
}

export class Agent {
  private messages: AgentMessage[] = [];
  private sessionId: string;
  private onEvent: EventCallback;
  private maxSteps = 10;

  constructor(sessionId: string, onEvent: EventCallback) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
  }

  private emit(type: ChatEvent["type"], content: string, metadata?: Record<string, any>) {
    const event: ChatEvent = {
      id: uuid(),
      type,
      content,
      metadata,
      timestamp: new Date().toISOString(),
    };
    this.onEvent(event);
    storage.addChatEvent(this.sessionId, event);
  }

  async run(userMessage: string): Promise<void> {
    this.emit("message", userMessage, { role: "user" });
    this.messages.push({ role: "user", content: userMessage });

    const { provider, model } = detectProvider();
    if (provider === "none") {
      this.emit("error", "No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROK_API_KEY.");
      return;
    }

    const systemPrompt = buildSystemPrompt();
    const tools = getToolDefinitions();

    try {
      if (provider === "claude") {
        await this.runClaude(systemPrompt, tools, model);
      } else {
        await this.runOpenAI(systemPrompt, tools, model, provider);
      }
    } catch (err: any) {
      this.emit("error", `Agent error: ${err.message}`);
    }
  }

  private async runClaude(systemPrompt: string, tools: ToolDef[], model: string) {
    const client = new Anthropic();
    const claudeTools: any[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    let step = 0;
    while (step < this.maxSteps) {
      step++;
      const msgs = this.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
      this.emit("thought", `Reasoning... (step ${step}/${this.maxSteps})`);

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: msgs,
        tools: claudeTools.length > 0 ? claudeTools : undefined,
      } as any);

      let hasToolUse = false;
      let textContent = "";

      for (const block of response.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          hasToolUse = true;
          this.emit("tool_call", JSON.stringify({ name: block.name, args: block.input }), { tool: block.name });
          const result = await executeTool(block.name, block.input as Record<string, any>);
          this.emit("tool_result", result, { tool: block.name });
          this.messages.push({ role: "assistant", content: `[Tool: ${block.name}] ${JSON.stringify(block.input)}` });
          this.messages.push({ role: "user", content: `[Tool Result for ${block.name}]: ${result}` });
        }
      }

      if (textContent) {
        this.emit("message", textContent, { role: "assistant" });
        this.messages.push({ role: "assistant", content: textContent });
      }

      if ((response as any).stop_reason === "end_turn" || !hasToolUse) break;
    }

    this.autoTitle();
  }

  private async runOpenAI(systemPrompt: string, tools: ToolDef[], model: string, provider: string) {
    const config: any = {};
    if (provider === "grok") {
      config.baseURL = "https://api.x.ai/v1";
      config.apiKey = process.env.GROK_API_KEY;
    }
    const client = new OpenAI(config);

    const openaiTools: any[] = tools.map(t => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    let step = 0;
    const openaiMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...this.messages.map(m => ({ role: m.role, content: m.content })),
    ];

    while (step < this.maxSteps) {
      step++;
      this.emit("thought", `Reasoning... (step ${step}/${this.maxSteps})`);

      const response = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        max_tokens: 4096,
      } as any);

      const choice = response.choices[0];
      const msg: any = choice.message;

      if (msg.content) {
        this.emit("message", msg.content, { role: "assistant" });
        this.messages.push({ role: "assistant", content: msg.content });
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        openaiMessages.push(msg);
        for (const tc of msg.tool_calls) {
          const fn = tc.function;
          const args = JSON.parse(fn.arguments);
          this.emit("tool_call", JSON.stringify({ name: fn.name, args }), { tool: fn.name });
          const result = await executeTool(fn.name, args);
          this.emit("tool_result", result, { tool: fn.name });
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
          this.messages.push({ role: "user", content: `[Tool Result for ${fn.name}]: ${result}` });
        }
      } else {
        break;
      }

      if (choice.finish_reason === "stop") break;
    }

    this.autoTitle();
  }

  private autoTitle() {
    if (this.messages.length <= 4) {
      const firstMsg = this.messages.find(m => m.role === "user");
      if (firstMsg) {
        const title = firstMsg.content.slice(0, 60) + (firstMsg.content.length > 60 ? "..." : "");
        storage.updateSession(this.sessionId, { title, status: "completed" });
      }
    }
  }
}
