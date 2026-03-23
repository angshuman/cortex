import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import fs from "fs";
import { v4 as uuid } from "uuid";
import { FileStorage } from "./storage";
import { mcpManager } from "./mcp-client";
import type { ChatEvent, Skill, VaultSettings, AgentSettings } from "@shared/schema";

type EventCallback = (event: ChatEvent) => void;

export interface ContextItem {
  type: "note" | "task" | "text";
  title: string;
  content: string;
  id?: string;
}

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

/**
 * Resolve the active AI provider and model.
 * Priority: config.json apiKeys > env vars.
 * Accepts optional VaultManager to read saved keys.
 */
function detectProvider(storage?: FileStorage): { provider: string; model: string } {
  // Try config keys first via storage's parent VaultManager
  // We access the VaultManager lazily to avoid circular deps
  try {
    const { vaultManager } = require("./storage");
    if (vaultManager) {
      const ak = vaultManager.resolveApiKey("anthropic");
      const ok = vaultManager.resolveApiKey("openai");
      const gk = vaultManager.resolveApiKey("grok");
      const goog = vaultManager.resolveApiKey("google");
      if (ak && ak.length > 10) return { provider: "claude", model: "claude-sonnet-4-20250514" };
      if (ok && ok.length > 10) return { provider: "openai", model: "gpt-4o" };
      if (gk && gk.length > 10) return { provider: "grok", model: "grok-3" };
      if (goog && goog.length > 10) return { provider: "google", model: "gemini-2.0-flash" };
    }
  } catch {}
  // Fallback to env vars only
  const ak = process.env.ANTHROPIC_API_KEY;
  const ok = process.env.OPENAI_API_KEY;
  const gk = process.env.GROK_API_KEY;
  const goog = process.env.GOOGLE_API_KEY;
  if (ak && ak.length > 10) return { provider: "claude", model: "claude-sonnet-4-20250514" };
  if (ok && ok.length > 10) return { provider: "openai", model: "gpt-4o" };
  if (gk && gk.length > 10) return { provider: "grok", model: "grok-3" };
  if (goog && goog.length > 10) return { provider: "google", model: "gemini-2.0-flash" };
  return { provider: "none", model: "none" };
}

/** Resolve an API key for a provider from config + env. */
function resolveKey(provider: "openai" | "anthropic" | "grok" | "google"): string {
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

/**
 * Select skills relevant to the current user message + context.
 * Priority 0 skills and skills without triggerKeywords are always included.
 * Others are matched by keyword against the user's message and context.
 */
function selectRelevantSkills(allSkills: Skill[], userMessage: string, contextItems: ContextItem[] = []): Skill[] {
  const messageLower = userMessage.toLowerCase();
  const contextText = contextItems.map(c => c.title + " " + c.content).join(" ").toLowerCase();
  const combined = messageLower + " " + contextText;

  const selected: Skill[] = [];
  for (const skill of allSkills) {
    if (!skill.enabled) continue;
    // Priority 0 = always include
    if ((skill.priority ?? 1) === 0) { selected.push(skill); continue; }
    // No trigger keywords = always include (backward compat)
    if (!skill.triggerKeywords || skill.triggerKeywords.length === 0) { selected.push(skill); continue; }
    // Match any trigger keyword
    if (skill.triggerKeywords.some(kw => combined.includes(kw.toLowerCase()))) {
      selected.push(skill);
    }
  }
  // Sort by priority (lower = more important = appears first in prompt)
  selected.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));
  return selected;
}

function getToolDefinitions(storage: FileStorage): ToolDef[] {
  const skills = storage.getSkills().filter((s: Skill) => s.enabled);
  const tools: ToolDef[] = [];
  
  // Collect skill-defined tool names to avoid duplicates with MCP
  const skillToolNames = new Set<string>();
  
  for (const skill of skills) {
    // instructionsOnly skills provide guidance only — no tool registration
    if (skill.instructionsOnly) continue;
    // Skip browser-use stub tools if MCP playwright is connected (MCP provides them)
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
  
  // Add tools from all connected MCP servers
  const toolsByServer = mcpManager.getToolsByServer();
  Array.from(toolsByServer.entries()).forEach(([serverName, mcpTools]) => {
    for (const mcpTool of mcpTools) {
      // Don't add if a skill already defines this tool name
      if (skillToolNames.has(mcpTool.name)) continue;
      
      // Convert MCP inputSchema to our ToolDef format
      const schema = mcpTool.inputSchema || {};
      tools.push({
        name: mcpTool.name,
        description: `[${serverName}] ${mcpTool.description}`,
        parameters: {
          type: "object" as const,
          properties: schema.properties || {},
          required: schema.required || [],
        },
      });
      skillToolNames.add(mcpTool.name); // Prevent duplicates across servers
    }
  });
  
  return tools;
}

async function executeTool(name: string, args: Record<string, any>, storage: FileStorage, agentSettings: AgentSettings = defaultAgentSettings): Promise<string> {
  try {
    switch (name) {
      case "create_note": {
        const note = storage.createNote({
          title: args.title || "Untitled",
          content: args.content || "",
          folder: args.folder,
          tags: args.tags,
        });
        // Migrate any chat asset images into the note's own assets folder
        const migratedContent = storage.migrateContentImages(note.id, note.content);
        if (migratedContent !== note.content) {
          storage.updateNote(note.id, { content: migratedContent, attachments: ["migrated"] });
        }
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
        if (args.content) {
          // Migrate any chat asset images into the note's own assets folder
          updates.content = storage.migrateContentImages(args.id, args.content);
        }
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
            signal: AbortSignal.timeout(agentSettings.fetchTimeout),
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
          if (body.length > agentSettings.fetchMaxLength) body = body.slice(0, agentSettings.fetchMaxLength) + "\n... (truncated)";
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
          let result = await mcpManager.callTool(server, name, args);
          // Post-tool-call hints: help the LLM handle common browser states
          if (name !== "browser_handle_dialog") {
            const lower = result.toLowerCase();
            if (lower.includes("dialog") || lower.includes("[modal]") || lower.includes("alert box")) {
              result += "\n\n[HINT: A dialog or popup appears to be present on the page. Use browser_handle_dialog to accept or dismiss it before continuing with other interactions.]";
            }
            if (lower.includes("cookie") || lower.includes("consent") || lower.includes("gdpr")) {
              result += "\n\n[HINT: A cookie consent banner is detected. Look for an 'Accept' or 'Allow all' button in the accessibility tree and click it to proceed.]";
            }
          }
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

function buildSystemPrompt(storage: FileStorage, vaultSettings?: VaultSettings, agentSettings?: AgentSettings, userMessage?: string, contextItems?: ContextItem[]): string {
  const allSkills = storage.getSkills();
  const relevant = selectRelevantSkills(allSkills, userMessage || "", contextItems || []);
  const skillInstructions = relevant.map((s: Skill) => s.instructions).filter(Boolean).join("\n\n");
  const notes = storage.getNotes();
  const tasks = storage.getTasks().filter((t: any) => t.status !== "archived");
  const taskSummary = tasks.length > 0
    ? `Current tasks:\n${tasks.slice(0, 15).map((t: any) => `- [${t.status}] ${t.title} (${t.priority})`).join("\n")}`
    : "No active tasks.";
  const notesSummary = notes.length > 0
    ? `Notes available:\n${notes.slice(0, 15).map((n: any) => `- "${n.title}" in ${n.folder}`).join("\n")}`
    : "No notes yet.";

  // Build MCP server status for all connected servers
  const toolsByServer = mcpManager.getToolsByServer();
  const mcpStatusParts: string[] = [];
  
  if (mcpManager.isConnected("playwright")) {
    const browserMode = vaultSettings?.browserHeadless ? "headless (no visible window)" : "visible (browser window will open)";
    const pwTools = mcpManager.getTools("playwright");
    mcpStatusParts.push(`**Playwright Browser** — CONNECTED (${browserMode} mode). ${pwTools.length} tools available: ${pwTools.map(t => t.name).join(", ")}.\nWhen browsing, always start with browser_snapshot to see the page accessibility tree, then use ref attributes to interact with elements.`);
  }
  
  Array.from(toolsByServer.entries()).forEach(([serverName, tools]) => {
    if (serverName === "playwright") return; // Already handled above
    mcpStatusParts.push(`**${serverName}** — CONNECTED. ${tools.length} tools available: ${tools.map((t: any) => t.name).join(", ")}.`);
  });
  
  const mcpStatus = mcpStatusParts.length > 0
    ? mcpStatusParts.join("\n\n")
    : "No MCP servers connected. The user can add servers in Settings > General > MCP Servers.";

  return `You are Cortex, a personal AI operating system assistant. You are a reasoner, planner, and note-taker.

## Your Capabilities
- Create, read, update, and organize notes (markdown with image support)
- Create, manage, and track tasks and subtasks
- Browse the web, access Microsoft 365 data, and more via MCP servers (see MCP Servers below)
- Search across all notes, tasks, and conversations
- Plan and reason through complex problems step by step
- **Vision**: You can see and analyze images pasted into chat

## MCP Servers
${mcpStatus}

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
You are an autonomous agent. When given a request:
1. **Plan first**: Think about the full scope of what's needed. For research or exploration tasks, identify ALL the steps required upfront.
2. **Execute thoroughly**: Use your tools in sequence to complete every step of your plan. Do NOT stop after one tool call if the task requires more.
3. **Chain tool calls**: If a tool result reveals new information or links to follow, continue investigating. For example, if you browse a page and see "Learn More" links the user wants explored, click each one and gather that information.
4. **Only summarize when truly done**: Do NOT generate a final text response until you have completed ALL steps. If you still have tools to call or links to visit, call the next tool instead of writing a summary.
5. **Be proactive**: If the user asks for "more details" or "deeper" investigation, that means you should exhaustively explore — follow every relevant link, extract all available information, and compile comprehensive results.

IMPORTANT: Do NOT ask "Would you like me to..." when the user's intent is clear. If they asked you to investigate something deeply, just do it. Use all available turns to gather information rather than stopping early to ask permission.

Always use markdown formatting in responses.

${skillInstructions}${agentSettings?.systemPromptSuffix ? `\n\n## Custom Instructions\n${agentSettings.systemPromptSuffix}` : ""}`;
}

// ContextItem is defined above selectRelevantSkills

const defaultAgentSettings: AgentSettings = {
  maxTurns: 10,
  maxTokens: 4096,
  temperature: 0.7,
  fetchTimeout: 15000,
  fetchMaxLength: 15000,
  systemPromptSuffix: "",
};

export class Agent {
  private messages: AgentMessage[] = [];
  private sessionId: string;
  private onEvent: EventCallback;
  private context: ContextItem[] = [];
  private storage: FileStorage;
  private vaultSettings: VaultSettings;
  private agentSettings: AgentSettings;

  constructor(sessionId: string, onEvent: EventCallback, context?: ContextItem[], storage?: FileStorage, vaultSettings?: VaultSettings, agentSettings?: AgentSettings) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
    this.context = context || [];
    this.vaultSettings = vaultSettings || { folderPath: null, browserHeadless: false, aiModel: null };
    this.agentSettings = agentSettings || defaultAgentSettings;
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
      this.emit("error", "No AI provider configured. Add an API key in Settings > General, or set ANTHROPIC_API_KEY, OPENAI_API_KEY, GROK_API_KEY, or GOOGLE_API_KEY as an environment variable.");
      return;
    }

    let systemPrompt = buildSystemPrompt(this.storage, this.vaultSettings, this.agentSettings, effectiveMessage, this.context);

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
    const apiKey = resolveKey("anthropic");
    const client = new Anthropic(apiKey ? { apiKey } : undefined);
    const claudeTools: any[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    let step = 0;
    const maxTurns = this.agentSettings.maxTurns;
    while (step < maxTurns) {
      step++;
      const msgs = messagesToClaude(this.messages, this.storage);
      this.emit("thought", `Reasoning... (step ${step}/${maxTurns})`);

      const response = await client.messages.create({
        model,
        max_tokens: this.agentSettings.maxTokens,
        ...(this.agentSettings.temperature !== undefined ? { temperature: this.agentSettings.temperature } : {}),
        system: systemPrompt,
        messages: msgs,
        tools: claudeTools.length > 0 ? claudeTools : undefined,
      } as any);

      // Track token usage
      if ((response as any).usage) {
        const u = (response as any).usage;
        this.storage.addTokenUsage(u.input_tokens || 0, u.output_tokens || 0);
      }

      let hasToolUse = false;
      let textContent = "";
      const toolResults: Array<{ name: string; input: any; result: string }> = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          hasToolUse = true;
          this.emit("tool_call", JSON.stringify({ name: block.name, args: block.input }), { tool: block.name });
          const result = await executeTool(block.name, block.input as Record<string, any>, this.storage, this.agentSettings);
          this.emit("tool_result", result, { tool: block.name });
          toolResults.push({ name: block.name, input: block.input, result });
        }
      }

      if (hasToolUse) {
        // Emit any intermediate text as a thought (not a final message)
        if (textContent) {
          this.emit("thought", textContent);
        }
        // For session persistence, record tool calls and results
        for (const tr of toolResults) {
          this.messages.push({ role: "assistant", content: `[Tool: ${tr.name}] ${JSON.stringify(tr.input)}` });
          this.messages.push({ role: "user", content: `[Tool Result for ${tr.name}]: ${tr.result}` });
        }
        // Continue the loop for the model to process results
        continue;
      }

      // No tool use — this is the final response
      if (textContent) {
        this.emit("message", textContent, { role: "assistant" });
        this.messages.push({ role: "assistant", content: textContent });
      }

      break;
    }

    this.autoTitle();
  }

  private async runOpenAI(systemPrompt: string, tools: ToolDef[], model: string, provider: string) {
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

    let step = 0;
    const openaiMessages: any[] = messagesToOpenAI(this.messages, systemPrompt, this.storage);

    const maxTurns = this.agentSettings.maxTurns;
    while (step < maxTurns) {
      step++;
      this.emit("thought", `Reasoning... (step ${step}/${maxTurns})`);

      const response = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        max_tokens: this.agentSettings.maxTokens,
        ...(this.agentSettings.temperature !== undefined ? { temperature: this.agentSettings.temperature } : {}),
      } as any);

      // Track token usage
      if (response.usage) {
        this.storage.addTokenUsage(
          response.usage.prompt_tokens || 0,
          response.usage.completion_tokens || 0
        );
      }

      const choice = response.choices[0];
      const msg: any = choice.message;

      // OpenAI can return content AND tool_calls in the same response.
      // We need to handle both properly.
      const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;

      if (hasToolCalls) {
        // Push the full assistant message (with tool_calls) into the OpenAI message chain.
        // This is required for OpenAI's tool calling protocol — the assistant message
        // containing tool_calls must precede the tool result messages.
        openaiMessages.push(msg);

        // If the model also produced text content alongside tool calls, emit it
        // but do NOT push it as a separate assistant message (it's part of the tool-call message above)
        if (msg.content) {
          this.emit("thought", msg.content);
        }

        // Execute all tool calls (OpenAI may issue multiple in parallel)
        for (const tc of msg.tool_calls) {
          const fn = tc.function;
          let args: Record<string, any>;
          try {
            args = JSON.parse(fn.arguments);
          } catch {
            args = {};
          }
          this.emit("tool_call", JSON.stringify({ name: fn.name, args }), { tool: fn.name });
          const result = await executeTool(fn.name, args, this.storage, this.agentSettings);
          this.emit("tool_result", result, { tool: fn.name });
          openaiMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
          // Also maintain the internal message history for session persistence
          this.messages.push({ role: "assistant", content: `[Tool: ${fn.name}] ${fn.arguments}` });
          this.messages.push({ role: "user", content: `[Tool Result for ${fn.name}]: ${result}` });
        }
        // Continue the loop — the model needs to process tool results
        continue;
      }

      // No tool calls — this is a final text response
      if (msg.content) {
        this.emit("message", msg.content, { role: "assistant" });
        this.messages.push({ role: "assistant", content: msg.content });
        openaiMessages.push({ role: "assistant", content: msg.content });
      }

      // Model is done (no tool calls = final answer)
      break;
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
