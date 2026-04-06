import { v4 as uuid } from "uuid";
import { FileStorage } from "./storage";
import { mcpManager } from "./mcp-client";
import type { ChatEvent, Skill, VaultSettings, AgentSettings } from "@shared/schema";
import {
  defaultAgentSettings,
  type EventCallback, type EmitFn, type AskUserFn,
  type ContextItem, type ContentBlock, type AgentMessage, type ToolDef,
} from "./agent-types";
import { detectProvider, callLLMJson } from "./agent-llm";
import { getToolDefinitions } from "./agent-tools";
import { runAgentLoop } from "./agent-loop";

export type { ContextItem };

// ── Skill selection ───────────────────────────────────────────────────────────

function selectRelevantSkills(
  allSkills: Skill[],
  userMessage: string,
  contextItems: ContextItem[] = [],
  forcedSkillNames: string[] = [],
): Skill[] {
  const combined = (userMessage + " " + contextItems.map(c => c.title + " " + c.content).join(" ")).toLowerCase();
  const selected: Skill[] = [];

  for (const skill of allSkills) {
    if (!skill.enabled) continue;
    if (forcedSkillNames.includes(skill.name)) { selected.push(skill); continue; }
    if ((skill.priority ?? 1) === 0) { selected.push(skill); continue; }
    if (!skill.triggerKeywords || skill.triggerKeywords.length === 0) { selected.push(skill); continue; }
    if (skill.triggerKeywords.some(kw => combined.includes(kw.toLowerCase()))) selected.push(skill);
  }

  selected.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));
  return selected;
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  storage: FileStorage,
  vaultSettings?: VaultSettings,
  agentSettings?: AgentSettings,
  userMessage?: string,
  contextItems?: ContextItem[],
  forcedSkillNames?: string[],
): string {
  const allSkills = storage.getSkills();
  const relevant = selectRelevantSkills(allSkills, userMessage || "", contextItems || [], forcedSkillNames || []);
  const skillInstructions = relevant.map((s: Skill) => s.instructions).filter(Boolean).join("\n\n");

  const notes = storage.getNotes();
  const tasks = storage.getTasks().filter((t: any) => t.status !== "archived");
  const taskSummary = tasks.length > 0
    ? `Current tasks:\n${tasks.slice(0, 15).map((t: any) => `- [${t.status}] ${t.title} (${t.priority})`).join("\n")}`
    : "No active tasks.";
  const notesSummary = notes.length > 0
    ? `Notes available:\n${notes.slice(0, 15).map((n: any) => `- "${n.title}" in ${n.folder}`).join("\n")}`
    : "No notes yet.";

  const toolsByServer = mcpManager.getToolsByServer();
  const mcpStatusParts: string[] = [];

  if (mcpManager.isConnected("playwright")) {
    const browserMode = vaultSettings?.browserHeadless ? "headless (no visible window)" : "visible (browser window will open)";
    const pwTools = mcpManager.getTools("playwright");
    mcpStatusParts.push(`**Playwright Browser** — CONNECTED (${browserMode} mode). ${pwTools.length} tools available: ${pwTools.map(t => t.name).join(", ")}.\nWhen browsing, always start with browser_snapshot to see the page accessibility tree, then use ref attributes to interact with elements.\n**PREFER the browser over web_fetch for ALL web access** — web_fetch is frequently blocked or returns empty results. Use browser_navigate + browser_snapshot instead.`);
  }
  Array.from(toolsByServer.entries()).forEach(([serverName, tools]) => {
    if (serverName === "playwright") return;
    mcpStatusParts.push(`**${serverName}** — CONNECTED. ${tools.length} tools available: ${(tools as any[]).map((t: any) => t.name).join(", ")}.`);
  });

  const mcpStatus = mcpStatusParts.length > 0
    ? mcpStatusParts.join("\n\n")
    : "No MCP servers connected. The user can add servers in Settings > MCP Servers.";

  return `You are Cortex — a deep-research AI agent that runs locally. Your purpose is to investigate, reason, and synthesize, then take action or produce polished deliverables. You operate autonomously across many steps.

## What You Do
- **Research and synthesize**: find answers, trace sources, compare options, summarize evidence across web, files, APIs, and documents
- **Plan and execute**: break complex goals into steps, carry them out in sequence, report progress, revise when something goes wrong
- **Write and build**: produce documents, code, spreadsheets, structured plans, and analyses — to high standards, not first drafts
- **Organize knowledge**: notes and tasks are your workspace and output, not your purpose
- **Verify and critique**: inspect what you produce before declaring done; surface uncertainty early
- **Vision**: analyze images, screenshots, and diagrams pasted into chat

## Tools and Integrations
- **Web browser** (Playwright): navigate, interact, screenshot — prefer this over web_fetch for real-world web access
- **Notes + tasks**: create, read, update, search — use as workspace and for structured output
- **Documents**: read/write .docx, .xlsx, .pdf, .pptx files
- **MCP servers**: pluggable tools for filesystem, GitHub, Microsoft 365, databases, and more (see Connected MCP Servers below)

## Connected MCP Servers
${mcpStatus}

## Image Handling
When a user sends images:
- You can see the image content. Describe what you observe.
- The image URLs are provided as text alongside the images (e.g. /api/chat/assets/xxx.png). Use these EXACT URLs in markdown.
- If the user asks you to do something with the image (save to note, extract info, create tasks), do it using your tools.
- If the user sends ONLY an image with no text, automatically:
  1. Analyze the image thoroughly (describe content, extract any text/data, identify key info)
  2. Create a note with a descriptive title summarizing the image content
  3. Include the image in the note markdown using the exact URL provided: \`![description](/api/chat/assets/xxx.png)\`
  4. Add metadata tags (e.g. screenshot, diagram, photo, receipt, code, whiteboard, document)
  5. Save it in the vault
- IMPORTANT: When creating notes from images, pass the image URLs via the \`image_urls\` parameter on \`create_note\`. This automatically copies the image into the note's own assets folder. Also include the URL in the markdown content as \`![description](url)\` — the system rewrites it to the copied path.
- Never fabricate or guess image URLs — always use the exact URLs provided in the message.

## Current Context
${taskSummary}

${notesSummary}

## Execution Approach — Gather → Critique → Act → Observe → Revise

**Every task follows this deliberate sequence:**

**1. Gather first.** Before writing a single word or making any change, collect context. Read relevant notes, search for information, fetch what exists — in parallel where possible. Never build before you understand what's there.

**2. Critique before building.** After gathering, reason about what you found. Say what the situation is, what's missing, what problems you see, and what approach you'll take. Write this out — a sentence or a paragraph — before moving to action. This is the think step: it surfaces issues before they become mistakes.

**3. Act with intention.** Now execute: write, create, update, search, or call. Do the real work based on your critique, not on assumptions.

**4. Observe your output.** After creating or modifying something important, verify it. Read back what you wrote. Check for correctness, completeness, and quality. Catch issues before declaring done — don't ship without inspecting.

**5. Revise surgically.** If something needs fixing, make targeted edits — not rewrites. Each correction is small and specific. Incremental improvement, not starting over.

**Practical rules:**
- **Parallel reads**: when you need multiple pieces of context, gather them all in one round of tool calls
- **Think out loud**: after gathering, write your analysis before the next tool call — even one sentence helps
- **Verify**: after creating something substantial (note, code, plan), read it back with a tool call to confirm it's right
- **Browser first for web**: use Playwright browser_navigate → browser_snapshot over web_fetch (web_fetch is frequently blocked by sites)
- **Notes as workspace**: for large or complex outputs, create a note to build into rather than generating everything in one shot

Always use markdown formatting in responses.

${skillInstructions}${agentSettings?.systemPromptSuffix ? `\n\n## Custom Instructions\n${agentSettings.systemPromptSuffix}` : ""}`;
}

// ── Agent class ───────────────────────────────────────────────────────────────

export class Agent {
  private messages: AgentMessage[] = [];
  private sessionId: string;
  private onEvent: EventCallback;
  private context: ContextItem[] = [];
  private storage: FileStorage;
  private vaultSettings: VaultSettings;
  private agentSettings: AgentSettings;

  constructor(
    sessionId: string,
    onEvent: EventCallback,
    context?: ContextItem[],
    storage?: FileStorage,
    vaultSettings?: VaultSettings,
    agentSettings?: AgentSettings,
  ) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
    this.context = context || [];
    this.vaultSettings = vaultSettings || { folderPath: null, browserHeadless: false, aiModel: null };
    // Merge with defaults — ensures old saved values (e.g. maxTurns:10) don't cap the agent
    this.agentSettings = { ...defaultAgentSettings, ...(agentSettings || {}) };
    // Bump any stale low cap (pre-200 default)
    if (this.agentSettings.maxTurns <= 50) this.agentSettings.maxTurns = 200;
    this.storage = storage || require("./storage").storage;
    this.loadHistory();
  }

  /** Reconstruct conversation history from persisted ChatEvents (for multi-turn sessions). */
  private loadHistory() {
    const session = this.storage.getSession(this.sessionId);
    if (!session?.events?.length) return;

    for (const event of session.events) {
      if (event.type !== "message") continue;
      const role = event.metadata?.role as "user" | "assistant" | undefined;
      if (!role) continue;

      if (role === "user") {
        const imageUrls: string[] = event.metadata?.images || [];
        if (imageUrls.length > 0) {
          const mimeMap: Record<string, string> = {
            png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
            gif: "image/gif", webp: "image/webp",
          };
          const blocks: ContentBlock[] = imageUrls.map(url => ({
            type: "image" as const,
            url,
            mediaType: mimeMap[url.split(".").pop()?.toLowerCase() || ""] || "image/png",
          }));
          const textContent = event.content.replace(/!\[image\]\([^)]+\)\n?/g, "").trim();
          blocks.push({ type: "text", text: textContent || "(user sent an image)" });
          this.messages.push({ role: "user", content: blocks });
        } else {
          this.messages.push({ role: "user", content: event.content });
        }
      } else if (role === "assistant") {
        this.messages.push({ role: "assistant", content: event.content });
      }
      // thought, tool_call, tool_result events are intentionally skipped —
      // the final assistant message already encapsulates the conversation for replay.
    }
  }

  /**
   * Lightweight intent extraction — one fast LLM call to understand what the user wants.
   * Emits an "intent" thought for the UI and returns the intent string so the
   * loop can use it to stay on track and verify completion.
   */
  private async extractIntent(userMessage: string, isImageOnly: boolean): Promise<string | null> {
    this.emit("thought", "Reading your request...");
    const result = await callLLMJson(
      `You are an intent extractor. Given a user message, write one concise sentence describing what they want to achieve. Be specific and action-oriented. Start with a verb.
Output ONLY valid JSON: { "intent": "..." }`,
      isImageOnly ? "(user sent an image with no text — analyze and save as note)" : userMessage,
      150,
    );
    if (result?.intent) {
      const intent = String(result.intent).trim();
      this.emit("thought", intent, { kind: "intent" });
      return intent;
    }
    return null;
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

  async run(userMessage: string, images?: Array<{ url: string; mediaType: string }>, forcedSkillNames?: string[], askUserFn?: AskUserFn): Promise<void> {
    // Emit user message for display
    const displayParts: string[] = [];
    if (images?.length) images.forEach(img => displayParts.push(`![image](${img.url})`));
    if (userMessage) displayParts.push(userMessage);
    this.emit("message", displayParts.join("\n"), { role: "user", images: images?.map(i => i.url) });

    // Build content blocks for the LLM
    const contentBlocks: ContentBlock[] = [];
    if (images?.length) {
      images.forEach(img => contentBlocks.push({ type: "image", url: img.url, mediaType: img.mediaType }));
      const urlList = images.map(i => i.url).join("\n");
      contentBlocks.push({ type: "text", text: `[Image URLs for reference — use these when creating notes]\n${urlList}` });
    }

    // Attach images from pinned context items
    if (this.context.length > 0) {
      const imgRegex = /!\[[^\]]*\]\((\/api\/(?:notes\/[^/]+\/assets|chat\/assets|files\/[^/]+\/[^)]+)\/[^)]*?)\)/g;
      for (const item of this.context) {
        if (item.type === "file" && item.mimeType?.startsWith("image/") && item.id) {
          const fileMeta = this.storage.getFiles().find((f: any) => f.id === item.id) as any;
          if (fileMeta) contentBlocks.push({ type: "image", url: `/api/files/${fileMeta.id}/${encodeURIComponent(fileMeta.name)}`, mediaType: item.mimeType });
          continue;
        }
        let match;
        const mimeMap: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
        while ((match = imgRegex.exec(item.content)) !== null) {
          const imgUrl = match[1];
          contentBlocks.push({ type: "image", url: imgUrl, mediaType: mimeMap[imgUrl.split(".").pop()?.toLowerCase() || ""] || "image/png" });
        }
      }
    }

    const effectiveMessage = userMessage || "The user pasted this image without any text. Analyze the image thoroughly: describe what you see, extract any text/data, identify key information, and then automatically save it as a note with a descriptive title. Include the image in the note content using the image URLs provided. Add relevant tags based on the content (e.g. screenshot, diagram, photo, receipt, code, whiteboard, etc). Save it in the vault.";
    contentBlocks.push({ type: "text", text: effectiveMessage });
    this.messages.push({ role: "user", content: contentBlocks });

    const { provider, model } = detectProvider();
    if (provider === "none") {
      this.emit("error", "No AI provider configured. Add an API key in Settings > General, or set ANTHROPIC_API_KEY, OPENAI_API_KEY, GROK_API_KEY, or GOOGLE_API_KEY as an environment variable.");
      return;
    }

    const isImageOnly = !userMessage && (images?.length ?? 0) > 0;
    const intent = await this.extractIntent(effectiveMessage, isImageOnly);

    let systemPrompt = buildSystemPrompt(this.storage, this.vaultSettings, this.agentSettings, effectiveMessage, this.context, forcedSkillNames);

    // Inject the extracted intent so the model has a clear goal on every loop turn
    // and can verify it has actually been met before producing a final response.
    if (intent) {
      systemPrompt += `\n\n## Your Goal for This Request\n${intent}\n\nBefore writing your final response: verify this goal has been fully achieved. Read back what you created or found. If it's incomplete or wrong, continue with targeted fixes.`;
    }

    if (this.context.length > 0) {
      const contextBlock = this.context.map(item => {
        const idStr = item.id ? ` (id: ${item.id})` : "";
        const header = item.type === "note" ? `Note: "${item.title}"${idStr}`
          : item.type === "task" ? `Task: "${item.title}"${idStr}`
          : item.type === "file" ? `File: "${item.title}"${idStr}`
          : `Context: "${item.title}"`;
        return `### ${header}\n${item.content}`;
      }).join("\n\n");
      systemPrompt += `\n\n## Active Context\nThe user has shared the following items. Their full content is already included below — use it directly. Do NOT call read_note, read_file, or read_document for these items unless you need to refresh them. If any notes contain images, those images are attached as visual content in this conversation.\n\n${contextBlock}`;
    }

    const tools = getToolDefinitions(this.storage);
    const emit: EmitFn = this.emit.bind(this);
    const compact = this.compactContext.bind(this);

    try {
      await runAgentLoop(provider, model, systemPrompt, tools, this.messages, this.storage, this.agentSettings, emit, compact, askUserFn);
    } catch (err: any) {
      this.emit("error", `Agent error: ${err.message}`);
    }

    this.autoTitle();
  }

  private async compactContext(inputTokens: number, provider: string): Promise<boolean> {
    const CONTEXT_WINDOW: Record<string, number> = {
      anthropic: 200_000, openai: 128_000, grok: 131_072, google: 1_000_000,
    };
    const usageRatio = inputTokens / (CONTEXT_WINDOW[provider] ?? 128_000);

    this.storage.updateSession(this.sessionId, { contextTokens: inputTokens });

    if (usageRatio < 0.50) return false;

    const keepCount = 4;
    if (this.messages.length <= keepCount) return false;

    const toCompact = this.messages.slice(0, this.messages.length - keepCount);
    const toKeep = this.messages.slice(this.messages.length - keepCount);

    this.emit("thought", `Context at ${Math.round(usageRatio * 100)}% — compacting conversation history to free up space...`);

    const transcript = toCompact.map(m => {
      const text = typeof m.content === "string"
        ? m.content
        : (m.content as any[]).filter(b => b.type === "text").map((b: any) => b.text).join(" ");
      return `${m.role.toUpperCase()}: ${text}`;
    }).join("\n\n");

    const summary = await callLLMJson(
      `You are a conversation summarizer. Given a transcript, produce a dense summary that preserves every fact, decision, result, and piece of created content — anything the assistant might need to continue helping. Be thorough but concise. Output ONLY valid JSON: { "summary": "..." }`,
      transcript,
      1500,
    );

    const summaryText = typeof summary?.summary === "string" && summary.summary.trim()
      ? summary.summary.trim()
      : `[Previous conversation compacted — ${toCompact.length} messages summarized]`;

    this.messages = [
      { role: "user", content: `[Conversation summary — context was compacted]\n\n${summaryText}` },
      { role: "assistant", content: "Understood. I have the context from earlier in the conversation." },
      ...toKeep,
    ];

    this.emit("thought", "Context compacted — continuing with full history preserved in summary.");
    return true;
  }

  private autoTitle() {
    if (this.messages.length > 4) return;
    const firstMsg = this.messages.find(m => m.role === "user");
    if (!firstMsg) return;

    const text = typeof firstMsg.content === "string"
      ? firstMsg.content
      : ((firstMsg.content as any[]).find(b => b.type === "text") as any)?.text || "";
    const prompt = text.trim() || "image";

    callLLMJson(
      `You generate ultra-short chat titles. Given a user message, return a 3–5 word topic title that captures the essence of what they want. Output ONLY valid JSON: { "title": "..." }
Rules:
- 3 to 5 words maximum — never more
- Title case (capitalize each main word)
- No punctuation at the end
- No generic phrases like "User Request" or "Help With Task"
- Focus on the specific topic, not the action (e.g. "Paris Travel Itinerary" not "Plan a trip to Paris")
- If it's an image with no text, use "Image Analysis" or a 3-word description of likely content`,
      prompt,
      100,
    ).then(result => {
      const title = typeof result?.title === "string" && result.title.trim()
        ? result.title.trim().slice(0, 60)
        : prompt.slice(0, 40) + (prompt.length > 40 ? "…" : "");
      this.storage.updateSession(this.sessionId, { title, status: "completed" });
    }).catch(() => {
      this.storage.updateSession(this.sessionId, { title: prompt.slice(0, 40) + (prompt.length > 40 ? "…" : ""), status: "completed" });
    });
  }
}
