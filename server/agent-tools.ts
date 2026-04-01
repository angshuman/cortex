import { FileStorage } from "./storage";
import { mcpManager } from "./mcp-client";
import type { AgentSettings, Skill } from "@shared/schema";
import { defaultAgentSettings, type ToolDef } from "./agent-types";

export function getToolDefinitions(storage: FileStorage): ToolDef[] {
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
      if (skillToolNames.has(mcpTool.name)) continue;
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
      skillToolNames.add(mcpTool.name); // prevent duplicates across servers
    }
  });

  return tools;
}

export async function executeTool(
  name: string,
  args: Record<string, any>,
  storage: FileStorage,
  agentSettings: AgentSettings = defaultAgentSettings,
): Promise<string> {
  try {
    switch (name) {
      case "create_note": {
        let content = args.content || "";
        const imageUrls: string[] = args.image_urls || [];

        const note = storage.createNote({
          title: args.title || "Untitled",
          content,
          folder: args.folder,
          tags: args.tags,
        });

        if (imageUrls.length > 0) {
          const imageParts: string[] = [];
          for (const imgUrl of imageUrls) {
            const newUrl = storage.migrateImageToNote(note.id, imgUrl);
            if (newUrl) imageParts.push(`![image](${newUrl})`);
          }
          if (imageParts.length > 0) content = imageParts.join("\n") + "\n\n" + content;
        }

        content = storage.migrateContentImages(note.id, content);
        if (content !== note.content) storage.updateNote(note.id, { content });

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
        if (args.content) updates.content = storage.migrateContentImages(args.id, args.content);
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
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const resp = await fetch(searchUrl, {
            headers: { "User-Agent": "Cortex/2.0 (search assistant)" },
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
          const html = await resp.text();

          const results: Array<{ title: string; url: string; snippet: string }> = [];
          const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi;
          let m;
          while ((m = resultRegex.exec(html)) !== null && results.length < 10) {
            const rawUrl = m[1];
            const urlMatch = rawUrl.match(/uddg=([^&]+)/);
            const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
            results.push({
              title: m[2].replace(/<[^>]+>/g, "").trim(),
              url,
              snippet: m[3].replace(/<[^>]+>/g, "").trim(),
            });
          }

          if (results.length === 0) {
            // Fallback: try HackerNews for tech queries
            const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8`;
            const hnResp = await fetch(hnUrl, { signal: AbortSignal.timeout(10000) });
            if (hnResp.ok) {
              const hnData = await hnResp.json() as any;
              for (const h of (hnData.hits || [])) {
                results.push({
                  title: h.title,
                  url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
                  snippet: `${h.points} points, ${h.num_comments} comments on HN`,
                });
              }
            }
          }

          return JSON.stringify({ query, results });
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
        const server = mcpManager.findServerForTool(name);
        if (!server) {
          return JSON.stringify({ error: `Browser tool "${name}" not available. Enable the Playwright browser backend in Settings > General, then ensure the MCP server is running (npx @playwright/mcp).` });
        }
        try {
          let result = await mcpManager.callTool(server, name, args);
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

      case "list_files": {
        const files = storage.getFiles();
        return JSON.stringify(files.map((f: any) => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType, createdAt: f.createdAt })));
      }

      case "read_file": {
        const fileText = storage.getFileText(args.id);
        if (fileText !== null) return fileText;
        const fileMeta = storage.getFiles().find((f: any) => f.id === args.id) as any;
        if (fileMeta?.mimeType?.startsWith("image/")) {
          return `[Image file: ${fileMeta.name}. The image is attached as visual content if in chat context.]`;
        }
        return JSON.stringify({ error: "File not found" });
      }

      case "search_files": {
        const q = (args.query || "").toLowerCase();
        const allFiles = storage.getFiles();
        const matches = allFiles.filter((f: any) => f.name.toLowerCase().includes(q));
        return JSON.stringify(matches.map((f: any) => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType })));
      }

      default: {
        const mcpServer = mcpManager.findServerForTool(name);
        if (mcpServer) {
          try {
            return await mcpManager.callTool(mcpServer, name, args);
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
