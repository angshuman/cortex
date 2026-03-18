import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import fs from "fs";
import { v4 as uuid } from "uuid";
import { FileStorage } from "./storage";
import { mcpManager } from "./mcp-client";
import type { ChatEvent, Skill, VaultSettings } from "@shared/schema";

type EventCallback = (event: ChatEvent) => void;

interface ImageBlock {
  type: "image";
  url: string;         // local URL like /api/chat/assets/xxx.png
  mediaType: string;   // e.g. image/png
}

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = TextBlock | ImageBlock;

interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
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

function getToolDefinitions(storage: FileStorage): ToolDef[] {
  const skills = storage.getSkills().filter((s: Skill) => s.enabled);
  const tools: ToolDef[] = [];
  
  // Collect skill-defined tool names to avoid duplicates with MCP
  const skillToolNames = new Set<string>();
  
  for (const skill of skills) {
    // Skip the stub browser-use skill if MCP playwright is connected
    if (skill.name === "browser-use" && mcpManager.isConnected("playwright")) continue;
    
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
      skillToolNames.add(tool.name);
    }
  }
  
  // Add tools from connected MCP servers (e.g. Playwright browser)
  const mcpTools = mcpManager.getTools();
  for (const mcpTool of mcpTools) {
    // Don't add if a skill already defines this tool name
    if (skillToolNames.has(mcpTool.name)) continue;
    
    // Convert MCP inputSchema to our ToolDef format
    const schema = mcpTool.inputSchema || {};
    tools.push({
      name: mcpTool.name,
      description: `[browser] ${mcpTool.description}`,
      parameters: {
        type: "object" as const,
        properties: schema.properties || {},
        required: schema.required || [],
      },
    });
  }
  
  return tools;
}

async function executeTool(name: string, args: Record<string, any>, storage: FileStorage): Promise<string> {
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
      case "browser_take_screenshot":
      case "browser_click":
      case "browser_type":
      case "browser_snapshot":
      case "browser_hover":
      case "browser_press_key":
      case "browser_tabs":
      case "browser_fill_form":
      case "browser_select_option":
      case "browser_handle_dialog":
      case "browser_file_upload":
      case "browser_evaluate":
      case "browser_drag":
      case "browser_console_messages":
      case "browser_wait":
      case "browser_verify_value":
      case "browser_mouse_click_xy":
      case "browser_mouse_drag_xy":
      case "browser_mouse_move_xy": {
        // Route through MCP client
        const server = mcpManager.findServerForTool(name);
        if (!server) {
          return JSON.stringify({ error: `Browser tool "${name}" not available. Enable the Playwright browser backend in Settings > General, then ensure the MCP server is running (npx @playwright/mcp).` });
        }
        try {
          const result = await mcpManager.callTool(server, name, args);
          return result;
        } catch (err: any) {
          return JSON.stringify({ error: `Browser tool error: ${err.message}` });
        }
      }
      default: {
        // Check if any MCP server handles this tool
        const mcpServer = mcpManager.findServerForTool(name);
        if (mcpServer) {
          try {
            const result = await mcpManager.callTool(mcpServer, name, args);
            return result;
          } catch (err: any) {
            return JSON.stringify({ error: `MCP tool error: ${err.message}` });
          }
        }
        return JSON.stringify({ error: `Unknown tool: ${name}` });
      }
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

function imageUrlToBase64(url: string, storage: FileStorage): { base64: string; mediaType: string } | null {
  try {
    // url is like /api/chat/assets/xxx.png — extract filename
    const match = url.match(/\/api\/chat\/assets\/(.+)$/);
    if (!match) {
      // Also support note assets: /api/notes/:id/assets/:filename
      const noteMatch = url.match(/\/api\/notes\/([^/]+)\/assets\/(.+)$/);
      if (noteMatch) {
        const buf = storage.getNoteAsset(noteMatch[1], noteMatch[2]);
        if (!buf) return null;
        const ext = noteMatch[2].split(".").pop()?.toLowerCase() || "png";
        const mimeMap: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
        };
        return { base64: buf.toString("base64"), mediaType: mimeMap[ext] || "image/png" };
      }
      return null;
    }
    const filename = match[1];
    const buf = storage.getChatAsset(filename);
    if (!buf) return null;
    const ext = filename.split(".").pop()?.toLowerCase() || "png";
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
    };
    return { base64: buf.toString("base64"), mediaType: mimeMap[ext] || "image/png" };
  } catch {
    return null;
  }
}

function messagesToClaude(messages: AgentMessage[], storage: FileStorage): any[] {
  return messages
    .filter(m => m.role !== "system")
    .map(m => {
      if (typeof m.content === "string") {
        return { role: m.role as "user" | "assistant", content: m.content };
      }
      // Convert content blocks
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

function messagesToOpenAI(messages: AgentMessage[], systemPrompt: string, storage: FileStorage): any[] {
  const result: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      result.push({ role: m.role, content: m.content });
    } else {
      // Convert content blocks to OpenAI format
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

function buildSystemPrompt(storage: FileStorage, vaultSettings?: VaultSettings): string {
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

  const browserMode = vaultSettings?.browserHeadless ? "headless (no visible window)" : "visible (browser window will open)";
  const browserConnected = mcpManager.isConnected("playwright");
  const mcpTools = mcpManager.getTools("playwright");
  const browserStatus = browserConnected
    ? `Browser is CONNECTED via Playwright MCP (${browserMode} mode). Available browser tools: ${mcpTools.map(t => t.name).join(", ")}.\nWhen browsing, always start with browser_snapshot to see the page accessibility tree, then use ref attributes to interact with elements.`
    : `Browser is NOT connected. The user needs to enable Playwright in Settings > General > Browser Backend, and ensure @playwright/mcp is installed (npx @playwright/mcp).`;

  return `You are Cortex, a personal AI operating system assistant. You are a reasoner, planner, and note-taker.

## Your Capabilities
- Create, read, update, and organize notes (markdown with image support)
- Create, manage, and track tasks and subtasks
- Browse the web using Playwright browser automation (see Browser Status below)
- Search across all notes, tasks, and conversations
- Plan and reason through complex problems step by step
- **Vision**: You can see and analyze images pasted into chat

## Browser Status
${browserStatus}

## Image Handling
When a user sends images:
- You can see the image content. Describe what you observe.
- If the user asks you to do something with the image (save to note, extract info, create tasks), do it using your tools.
- If the user sends ONLY an image with no text, automatically:
  1. Analyze the image thoroughly (describe content, extract any text/data, identify key info)
  2. Create a note with a descriptive title summarizing the image content
  3. Include the image in the note markdown as \`![description](image_url)\`
  4. Add metadata tags (e.g. screenshot, diagram, photo, receipt, code, whiteboard, document)
  5. Put it in /inbox folder
- When creating notes from images, always include the original image URL in the markdown content so the image is visible in the note.

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

export interface ContextItem {
  type: "note" | "task" | "text";
  title: string;
  content: string;
  id?: string;
}

export class Agent {
  private messages: AgentMessage[] = [];
  private sessionId: string;
  private onEvent: EventCallback;
  private maxSteps = 10;
  private context: ContextItem[] = [];
  private storage: FileStorage;
  private vaultSettings: VaultSettings;

  constructor(sessionId: string, onEvent: EventCallback, context?: ContextItem[], storage?: FileStorage, vaultSettings?: VaultSettings) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
    this.context = context || [];
    this.vaultSettings = vaultSettings || { folderPath: null, browserHeadless: false, aiModel: null };
    // Use provided vault-scoped storage, or import the default
    this.storage = storage || require("./storage").storage;
    // Rebuild conversation history from persisted session events
    this.loadHistory();
  }

  /**
   * Reconstruct AgentMessage[] from the persisted ChatEvents in this session.
   * This ensures follow-up messages have full conversation context including
   * images from earlier turns.
   */
  private loadHistory() {
    const session = this.storage.getSession(this.sessionId);
    if (!session || !session.events || session.events.length === 0) return;

    for (const event of session.events) {
      if (event.type === "message") {
        const role = event.metadata?.role as "user" | "assistant" | undefined;
        if (!role) continue;

        if (role === "user") {
          // Check if this user message had images attached
          const imageUrls: string[] = event.metadata?.images || [];
          if (imageUrls.length > 0) {
            // Reconstruct multimodal content blocks
            const blocks: ContentBlock[] = [];
            for (const url of imageUrls) {
              // Guess mediaType from extension
              const ext = url.split(".").pop()?.toLowerCase() || "png";
              const mimeMap: Record<string, string> = {
                png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                gif: "image/gif", webp: "image/webp",
              };
              blocks.push({ type: "image", url, mediaType: mimeMap[ext] || "image/png" });
            }
            // Extract the text portion (strip image markdown)
            const textContent = event.content.replace(/!\[image\]\([^)]+\)\n?/g, "").trim();
            if (textContent) {
              blocks.push({ type: "text", text: textContent });
            } else {
              // Image-only: add a brief note so the LLM knows an image was analyzed
              blocks.push({ type: "text", text: "(user sent an image)" });
            }
            this.messages.push({ role: "user", content: blocks });
          } else {
            // Pure text message
            this.messages.push({ role: "user", content: event.content });
          }
        } else if (role === "assistant") {
          this.messages.push({ role: "assistant", content: event.content });
        }
      }
      // We skip thought, tool_call, tool_result events for history reconstruction.
      // The assistant's final text response already summarizes tool results,
      // and re-including tool calls would confuse the conversation flow.
    }
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
    this.storage.addChatEvent(this.sessionId, event);
  }

  async run(userMessage: string, images?: Array<{ url: string; mediaType: string }>): Promise<void> {
    // Build display text (shown in UI)
    const displayParts: string[] = [];
    if (images && images.length > 0) {
      for (const img of images) {
        displayParts.push(`![image](${img.url})`);
      }
    }
    if (userMessage) displayParts.push(userMessage);
    this.emit("message", displayParts.join("\n"), { role: "user", images: images?.map(i => i.url) });

    // Build the actual content blocks for the LLM
    const contentBlocks: ContentBlock[] = [];
    if (images && images.length > 0) {
      for (const img of images) {
        contentBlocks.push({ type: "image", url: img.url, mediaType: img.mediaType });
      }
    }

    // If user sent only image(s) with no text, inject auto-analysis instruction
    const effectiveMessage = userMessage || "The user pasted this image without any text. Analyze the image thoroughly: describe what you see, extract any text/data, identify key information, and then automatically save it as a note with a descriptive title. Include the image in the note content. Add relevant tags based on the content (e.g. screenshot, diagram, photo, receipt, code, whiteboard, etc). Put it in the /inbox folder.";
    contentBlocks.push({ type: "text", text: effectiveMessage });

    this.messages.push({ role: "user", content: contentBlocks });

    const { provider, model } = detectProvider();
    if (provider === "none") {
      this.emit("error", "No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROK_API_KEY.");
      return;
    }

    let systemPrompt = buildSystemPrompt(this.storage, this.vaultSettings);

    // Inject context items into system prompt
    if (this.context.length > 0) {
      const contextBlock = this.context.map((item, i) => {
        const header = item.type === "note" ? `Note: "${item.title}"` :
                       item.type === "task" ? `Task: "${item.title}"` :
                       `Context: "${item.title}"`;
        return `### ${header}\n${item.content}`;
      }).join("\n\n");
      systemPrompt += `\n\n## Active Context\nThe user is viewing the following items. Reference them directly when relevant.\n\n${contextBlock}`;
    }

    const tools = getToolDefinitions(this.storage);

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
      const msgs = messagesToClaude(this.messages, this.storage);
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
          const result = await executeTool(block.name, block.input as Record<string, any>, this.storage);
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
    const openaiMessages: any[] = messagesToOpenAI(this.messages, systemPrompt, this.storage);

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
          const result = await executeTool(fn.name, args, this.storage);
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
        let text = "";
        if (typeof firstMsg.content === "string") {
          text = firstMsg.content;
        } else {
          // Extract text from content blocks
          const textBlock = firstMsg.content.find(b => b.type === "text");
          text = textBlock?.type === "text" ? textBlock.text : "Image conversation";
        }
        const title = text.slice(0, 60) + (text.length > 60 ? "..." : "");
        this.storage.updateSession(this.sessionId, { title, status: "completed" });
      }
    }
  }
}
