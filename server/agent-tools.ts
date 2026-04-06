import { FileStorage } from "./storage";
import { mcpManager } from "./mcp-client";
import type { AgentSettings, Skill } from "@shared/schema";
import { defaultAgentSettings, type ToolDef } from "./agent-types";
import path from "path";
import fs from "fs";

// ── Document tools (loaded lazily so missing libs don't break startup) ────────
async function readDocumentFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${filePath}`);

  if (ext === ".pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = fs.readFileSync(absPath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === ".docx" || ext === ".doc") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: absPath });
    return result.value;
  }
  if (ext === ".txt" || ext === ".md") {
    return fs.readFileSync(absPath, "utf-8");
  }
  throw new Error(`Unsupported document format: ${ext}`);
}

async function readSpreadsheetFile(filePath: string, sheetName?: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${filePath}`);

  if ([".xlsx", ".xls", ".csv", ".ods"].includes(ext)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.readFile(absPath);
    const sheet = sheetName
      ? wb.Sheets[sheetName]
      : wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    return JSON.stringify(rows);
  }
  throw new Error(`Unsupported spreadsheet format: ${ext}`);
}

async function writeDocumentFile(filePath: string, content: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const absPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  if (ext === ".docx") {
    const { Document, Paragraph, TextRun, Packer } = await import("docx");
    const paragraphs = content.split("\n").map(line =>
      new Paragraph({ children: [new TextRun(line)] })
    );
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buf = await Packer.toBuffer(doc);
    fs.writeFileSync(absPath, buf);
    return;
  }
  if (ext === ".txt" || ext === ".md") {
    fs.writeFileSync(absPath, content, "utf-8");
    return;
  }
  throw new Error(`Unsupported write format: ${ext}`);
}

async function writeSpreadsheetFile(filePath: string, rowsJson: string, sheetName = "Sheet1"): Promise<void> {
  const absPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const XLSX = await import("xlsx");
  const rows = JSON.parse(rowsJson);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, absPath);
}

async function listSpreadsheetSheets(filePath: string): Promise<string> {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${filePath}`);
  const XLSX = await import("xlsx");
  const wb = XLSX.readFile(absPath);
  return JSON.stringify(wb.SheetNames);
}

// ── Document tool definitions ─────────────────────────────────────────────────
const DOCUMENT_TOOL_DEFS: ToolDef[] = [
  {
    name: "read_document",
    description: "Read the text content of a Word (.docx), PDF (.pdf), or plain text (.txt, .md) file. Returns the extracted text.",
    parameters: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute or relative file path to the document." },
      },
      required: ["path"],
    },
  },
  {
    name: "read_spreadsheet",
    description: "Read rows from an Excel (.xlsx, .xls) or CSV file. Returns a JSON array of rows. Optionally specify a sheet name.",
    parameters: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute or relative file path to the spreadsheet." },
        sheet: { type: "string", description: "Optional sheet name. Defaults to the first sheet." },
      },
      required: ["path"],
    },
  },
  {
    name: "list_spreadsheet_sheets",
    description: "List all sheet names in an Excel workbook.",
    parameters: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute or relative path to the .xlsx file." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_document",
    description: "Write text content to a file. Supports .docx (creates a Word document) and .txt/.md (plain text). Creates parent directories if needed.",
    parameters: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute or relative output file path." },
        content: { type: "string", description: "Text content to write. For .docx, each newline becomes a new paragraph." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "write_spreadsheet",
    description: "Write rows to an Excel (.xlsx) file. rows_json should be a JSON array of arrays (rows of cells). Creates a new file or overwrites.",
    parameters: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute or relative output .xlsx file path." },
        rows_json: { type: "string", description: "JSON array of arrays representing rows and cells, e.g. [[\"Name\",\"Score\"],[\"Alice\",95]]" },
        sheet_name: { type: "string", description: "Optional sheet name. Defaults to 'Sheet1'." },
      },
      required: ["path", "rows_json"],
    },
  },
];

export function getToolDefinitions(storage: FileStorage, selectedSkills?: Skill[]): ToolDef[] {
  const skills = (selectedSkills ?? storage.getSkills()).filter((s: Skill) => s.enabled);
  const tools: ToolDef[] = [];

  // Built-in tool — always available, not skill-based
  tools.push({
    name: "ask_clarification",
    description: "Ask the user a clarifying question when a key piece of information is missing and cannot be reasonably assumed. Use sparingly — only when truly needed. Optionally provide multiple choices; the user can pick one or write their own answer.",
    parameters: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "The clarifying question to ask the user." },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of suggested choices. The user can select one or provide a custom answer.",
        },
      },
      required: ["question"],
    },
  });

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

  // Document tools — always available
  tools.push(...DOCUMENT_TOOL_DEFS);

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

      case "read_document": {
        const text = await readDocumentFile(args.path as string);
        return text.length > 20000 ? text.slice(0, 20000) + "\n\n[...truncated]" : text;
      }

      case "read_spreadsheet": {
        return await readSpreadsheetFile(args.path as string, args.sheet as string | undefined);
      }

      case "list_spreadsheet_sheets": {
        return await listSpreadsheetSheets(args.path as string);
      }

      case "write_document": {
        await writeDocumentFile(args.path as string, args.content as string);
        return JSON.stringify({ ok: true, path: args.path });
      }

      case "write_spreadsheet": {
        await writeSpreadsheetFile(args.path as string, args.rows_json as string, args.sheet_name as string | undefined);
        return JSON.stringify({ ok: true, path: args.path });
      }

      case "list_files": {
        const files = storage.getFiles();
        return JSON.stringify(files.map((f: any) => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType, createdAt: f.createdAt })));
      }

      case "read_file": {
        const fileMeta = storage.getFiles().find((f: any) => f.id === args.id) as any;
        if (!fileMeta) return JSON.stringify({ error: "File not found" });

        const fileData = storage.getFile(args.id);
        if (!fileData) return JSON.stringify({ error: "File not found" });

        const { buffer, name, mimeType } = fileData;
        const ext = path.extname(name).toLowerCase();

        // Office documents — extract text using document libraries
        if (ext === ".docx" || ext === ".doc" || mimeType.includes("word") || mimeType.includes("officedocument.wordprocessing")) {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          const text = result.value.trim();
          return text.length > 0 ? text.slice(0, 20000) : `[${name}: document appears empty]`;
        }
        if ([".xlsx", ".xls", ".ods"].includes(ext) || mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buffer);
          const parts: string[] = [];
          for (const sheetName of wb.SheetNames) {
            const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
            parts.push(`=== Sheet: ${sheetName} ===\n${rows.map(r => r.join("\t")).join("\n")}`);
          }
          return parts.join("\n\n").slice(0, 20000);
        }
        if (ext === ".pdf" || mimeType.includes("pdf")) {
          const pdfParse = (await import("pdf-parse")).default;
          const data = await pdfParse(buffer);
          return data.text.slice(0, 20000);
        }

        // Images — visual content, can't return as text
        if (mimeType.startsWith("image/")) {
          return `[Image file: ${name}. The image is attached as visual content if in chat context.]`;
        }

        // Plain text / code / other text-based files
        const text = storage.getFileText(args.id);
        if (text !== null) return text;
        return `[Binary file: ${name} (${mimeType}) — cannot display as text]`;
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
