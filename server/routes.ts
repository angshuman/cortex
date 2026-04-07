import type { Express, Request } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { skillSchema } from "@shared/schema";
import { vaultManager, FileStorage } from "./storage";
import { Agent, type ContextItem } from "./agent";
import { pickModelForProvider } from "./agent-llm";
import { mcpManager } from "./mcp-client";
import { log, logError } from "./index";
import type { AskUserFn } from "./agent-types";
import multer from "multer";
import path from "path";
import fs from "fs";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Read version from package.json once at startup
function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}
const APP_VERSION = readPackageVersion();

const activeAgents = new Map<string, { agent: Agent | null; ws: Set<WebSocket> }>();

/** Pending ask_clarification resolvers — keyed by sessionId. Resolved when the client sends a clarification_response. */
const pendingClarifications = new Map<string, (answer: string) => void>();

/**
 * Resolve the FileStorage for a request.
 * The vault is determined by ?vault=<vaultId> query param.
 * Falls back to the default vault if not specified.
 */
function getVaultStorage(req: Request): FileStorage {
  const vaultId = req.query.vault as string | undefined;
  if (vaultId) {
    return vaultManager.getStorage(vaultId);
  }
  return vaultManager.getStorage(vaultManager.getDefaultVault().id);
}

export function registerRoutes(server: Server, app: Express) {
  // ============ VAULTS ============
  app.get("/api/vaults", (_req, res) => {
    res.json(vaultManager.getVaults());
  });

  app.get("/api/vaults/:id", (req, res) => {
    const vault = vaultManager.getVault(req.params.id as string);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    res.json(vault);
  });

  app.post("/api/vaults", (req, res) => {
    const vault = vaultManager.createVault(req.body);
    res.status(201).json(vault);
  });

  app.patch("/api/vaults/:id", (req, res) => {
    const vault = vaultManager.updateVault(req.params.id as string, req.body);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    res.json(vault);
  });

  // Vault settings (convenience endpoint)
  app.get("/api/vaults/:id/settings", (req, res) => {
    const vault = vaultManager.getVault(req.params.id as string);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    res.json(vault.settings || { folderPath: null, browserHeadless: false, aiModel: null });
  });

  app.patch("/api/vaults/:id/settings", (req, res) => {
    const vault = vaultManager.updateVault(req.params.id as string, { settings: req.body });
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    res.json(vault.settings);
  });

  // Resolve vault data directory (for display in UI)
  app.get("/api/vaults/:id/path", (req, res) => {
    const vault = vaultManager.getVault(req.params.id as string);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    try {
      const storage = vaultManager.getStorage(vault.id);
      res.json({
        path: storage.getDataDir(),
        rootFolder: vault.settings?.folderPath || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/vaults/:id", (req, res) => {
    const ok = vaultManager.deleteVault(req.params.id as string);
    if (!ok) return res.status(400).json({ error: "Cannot delete vault (last vault or not found)" });
    res.json({ success: true });
  });

  // ============ VAULT FILE BROWSER ============
  function buildFileTree(absPath: string, rootFolder: string): any[] {
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    const result: any[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // skip hidden
      const entryAbs = path.join(absPath, entry.name);
      const entryRel = path.relative(rootFolder, entryAbs).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        result.push({ name: entry.name, path: entryRel, type: "directory", children: buildFileTree(entryAbs, rootFolder) });
      } else {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        const stat = fs.statSync(entryAbs);
        result.push({ name: entry.name, path: entryRel, type: "file", ext, size: stat.size });
      }
    }
    return result.sort((a: any, b: any) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  app.get("/api/vaults/:id/files", (req, res) => {
    const vault = vaultManager.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    const rootFolder = vault.settings?.folderPath;
    if (!rootFolder) return res.status(400).json({ error: "Vault has no folder path" });
    try {
      res.json(buildFileTree(rootFolder, rootFolder));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/vaults/:id/files", (req, res) => {
    const vault = vaultManager.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    const rootFolder = vault.settings?.folderPath;
    if (!rootFolder) return res.status(400).json({ error: "Vault has no folder path" });
    const { filePath, type, content = "" } = req.body as { filePath: string; type: "file" | "directory"; content?: string };
    const absPath = path.join(rootFolder, filePath);
    if (!absPath.startsWith(rootFolder)) return res.status(403).json({ error: "Forbidden" });
    try {
      if (type === "directory") {
        fs.mkdirSync(absPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        if (!fs.existsSync(absPath)) fs.writeFileSync(absPath, content, "utf8");
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/vaults/:id/files", (req, res) => {
    const vault = vaultManager.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    const rootFolder = vault.settings?.folderPath;
    if (!rootFolder) return res.status(400).json({ error: "Vault has no folder path" });
    const { filePath, newName } = req.body as { filePath: string; newName: string };
    const absOld = path.join(rootFolder, filePath);
    const absNew = path.join(path.dirname(absOld), newName);
    if (!absOld.startsWith(rootFolder) || !absNew.startsWith(rootFolder)) return res.status(403).json({ error: "Forbidden" });
    try {
      fs.renameSync(absOld, absNew);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/vaults/:id/files", (req, res) => {
    const vault = vaultManager.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    const rootFolder = vault.settings?.folderPath;
    if (!rootFolder) return res.status(400).json({ error: "Vault has no folder path" });
    const filePath = req.query.path as string;
    const absPath = path.join(rootFolder, filePath);
    if (!absPath.startsWith(rootFolder)) return res.status(403).json({ error: "Forbidden" });
    try {
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        fs.rmSync(absPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(absPath);
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Lookup note by relative file path (for file browser → editor integration)
  app.get("/api/vaults/:id/note-by-path", (req, res) => {
    const vault = vaultManager.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    const store = vaultManager.getStorage(vault.id);
    const filePath = req.query.path as string;
    try {
      const note = store.getNoteByFilePath(filePath);
      if (!note) return res.status(404).json({ error: "Note not found" });
      res.json(note);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve raw file content for preview and context injection
  app.get("/api/vaults/:id/file-content", async (req, res) => {
    const vault = vaultManager.getVault(req.params.id);
    if (!vault) return res.status(404).json({ error: "Vault not found" });
    const rootFolder = vault.settings?.folderPath;
    if (!rootFolder) return res.status(400).json({ error: "Vault has no folder path" });

    const relPath = req.query.path as string;
    if (!relPath) return res.status(400).json({ error: "path is required" });
    const absPath = path.join(rootFolder, relPath);
    if (!absPath.startsWith(rootFolder)) return res.status(403).json({ error: "Forbidden" });

    try {
      const ext = path.extname(relPath).toLowerCase();
      const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"];
      const SHEET_EXTS = [".xlsx", ".xls", ".csv"];

      if (IMAGE_EXTS.includes(ext)) {
        const buf = fs.readFileSync(absPath);
        const mime = ext === ".svg" ? "image/svg+xml" : `image/${ext.slice(1).replace("jpg", "jpeg")}`;
        return res.json({ type: "image", mimeType: mime, base64: buf.toString("base64"), name: path.basename(relPath) });
      }

      if (SHEET_EXTS.includes(ext)) {
        const { default: XLSX } = await import("xlsx");
        if (ext === ".csv") {
          const raw = fs.readFileSync(absPath, "utf-8");
          const ws = XLSX.utils.csv_to_sheet(raw);
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          return res.json({ type: "spreadsheet", rows, name: path.basename(relPath) });
        } else {
          const wb = XLSX.readFile(absPath);
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          return res.json({ type: "spreadsheet", rows, sheetName, sheets: wb.SheetNames, name: path.basename(relPath) });
        }
      }

      // All other files: return as text (truncate at 200k chars)
      const raw = fs.readFileSync(absPath, "utf-8");
      return res.json({ type: "text", content: raw.length > 200000 ? raw.slice(0, 200000) + "\n\n[Truncated]" : raw, ext: ext.slice(1), name: path.basename(relPath) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ NOTES (vault-scoped via ?vault=) ============
  app.get("/api/notes", (req, res) => {
    const store = getVaultStorage(req);
    res.json(store.getNotes());
  });

  app.get("/api/notes/folders", (req, res) => {
    const store = getVaultStorage(req);
    res.json(store.getNoteFolders());
  });

  app.get("/api/notes/:id", (req, res) => {
    const store = getVaultStorage(req);
    const note = store.getNote(req.params.id as string);
    if (!note) return res.status(404).json({ error: "Not found" });
    res.json(note);
  });

  app.post("/api/notes", (req, res) => {
    const store = getVaultStorage(req);
    const note = store.createNote(req.body);
    res.status(201).json(note);
  });

  app.patch("/api/notes/:id", (req, res) => {
    const store = getVaultStorage(req);
    const note = store.updateNote(req.params.id as string, req.body);
    if (!note) return res.status(404).json({ error: "Not found" });
    res.json(note);
  });

  app.delete("/api/notes/:id", (req, res) => {
    const store = getVaultStorage(req);
    const ok = store.deleteNote(req.params.id as string);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  app.delete("/api/notes", (req, res) => {
    const store = getVaultStorage(req);
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    const deleted = store.bulkDeleteNotes(ids);
    res.json({ deleted });
  });

  // ============ NOTE GROUPS ============
  app.get("/api/note-groups", (req, res) => {
    const vaultId = req.query.vault as string | undefined;
    const vault = vaultId ? vaultManager.getVault(vaultId) : vaultManager.getDefaultVault();
    const store = getVaultStorage(req);
    res.json(store.getNoteGroups(vault?.name));
  });

  app.post("/api/note-groups", (req, res) => {
    const store = getVaultStorage(req);
    const group = store.createNoteGroup(req.body);
    res.status(201).json(group);
  });

  app.patch("/api/note-groups/:id", (req, res) => {
    const store = getVaultStorage(req);
    const group = store.updateNoteGroup(req.params.id as string, req.body);
    if (!group) return res.status(404).json({ error: "Not found" });
    res.json(group);
  });

  app.delete("/api/note-groups/:id", (req, res) => {
    const store = getVaultStorage(req);
    const ok = store.deleteNoteGroup(req.params.id as string);
    if (!ok) return res.status(400).json({ error: "Cannot delete default group or group not found" });
    res.json({ success: true });
  });

  app.post("/api/notes/:id/assets", upload.single("file"), (req: any, res: any) => {
    const store = getVaultStorage(req);
    if (!req.file) return res.status(400).json({ error: "No file" });
    const filename = `${Date.now()}-${req.file.originalname}`;
    const url = store.saveNoteAsset(req.params.id, filename, req.file.buffer);
    res.json({ url, filename });
  });

  app.get("/api/notes/:id/assets/:filename", (req, res) => {
    // Try the requested vault first, then fall back to searching all vaults
    const noteId = req.params.id as string;
    const filename = req.params.filename as string;
    let buffer = getVaultStorage(req).getNoteAsset(noteId, filename);
    if (!buffer) {
      // Search all vaults for this asset
      for (const vault of vaultManager.getVaults()) {
        const store = vaultManager.getStorage(vault.id);
        buffer = store.getNoteAsset(noteId, filename);
        if (buffer) break;
      }
    }
    if (!buffer) return res.status(404).end();
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    };
    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(buffer);
  });

  app.post("/api/notes/inbox/dump", upload.single("file"), (req: any, res: any) => {
    const store = getVaultStorage(req);
    const title = req.body.title || `Dump ${new Date().toLocaleString()}`;
    let content = req.body.content || "";
    let note = store.createNote({ title, content, folder: "/", tags: ["dump"] });
    if (req.file) {
      const filename = `${Date.now()}-${req.file.originalname}`;
      const url = store.saveNoteAsset(note.id, filename, req.file.buffer);
      content += `\n\n![${req.file.originalname}](${url})`;
      const updated = store.updateNote(note.id, { content, attachments: [url] });
      if (updated) note = updated;
    }
    res.status(201).json(note);
  });

  // ============ TASKS (vault-scoped) ============
  app.get("/api/tasks", (req, res) => {
    const store = getVaultStorage(req);
    res.json(store.getTasks());
  });

  app.get("/api/tasks/:id", (req, res) => {
    const store = getVaultStorage(req);
    const task = store.getTask(req.params.id as string);
    if (!task) return res.status(404).json({ error: "Not found" });
    res.json(task);
  });

  app.post("/api/tasks", (req, res) => {
    const store = getVaultStorage(req);
    const task = store.createTask(req.body);
    res.status(201).json(task);
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const store = getVaultStorage(req);
    const task = store.updateTask(req.params.id as string, req.body);
    if (!task) return res.status(404).json({ error: "Not found" });
    res.json(task);
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const store = getVaultStorage(req);
    const ok = store.deleteTask(req.params.id as string);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  app.post("/api/tasks/reorder", (req, res) => {
    const store = getVaultStorage(req);
    store.reorderTasks(req.body.taskIds);
    res.json({ success: true });
  });

  // ============ CHAT SESSIONS (vault-scoped) ============
  app.get("/api/chat/sessions", (req, res) => {
    const store = getVaultStorage(req);
    res.json(store.getSessions());
  });

  app.post("/api/chat/sessions", (req, res) => {
    const store = getVaultStorage(req);
    const session = store.createSession(req.body.title);
    res.status(201).json(session);
  });

  app.get("/api/chat/sessions/:id", (req, res) => {
    const store = getVaultStorage(req);
    const session = store.getSession(req.params.id as string);
    if (!session) return res.status(404).json({ error: "Not found" });
    res.json(session);
  });

  app.delete("/api/chat/sessions/:id", (req, res) => {
    const store = getVaultStorage(req);
    store.deleteSession(req.params.id as string);
    res.json({ success: true });
  });

  // ============ CHAT ASSETS (vault-scoped) ============
  app.post("/api/chat/assets", upload.single("file"), (req: any, res: any) => {
    const store = getVaultStorage(req);
    if (!req.file) return res.status(400).json({ error: "No file" });
    const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const url = store.saveChatAsset(filename, req.file.buffer);
    res.json({ url, filename });
  });

  app.get("/api/chat/assets/:filename", (req, res) => {
    const filename = req.params.filename as string;
    // Try the requested vault first, then fall back to searching all vaults
    let buffer = getVaultStorage(req).getChatAsset(filename);
    if (!buffer) {
      for (const vault of vaultManager.getVaults()) {
        const store = vaultManager.getStorage(vault.id);
        buffer = store.getChatAsset(filename);
        if (buffer) break;
      }
    }
    if (!buffer) return res.status(404).end();
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
    };
    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(buffer);
  });

  // ============ FILES (vault-scoped) ============
  app.get("/api/files", (req, res) => {
    const store = getVaultStorage(req);
    const files = store.getFiles();
    // Add url to each file
    res.json(files.map((f: any) => ({ ...f, url: `/api/files/${f.id}/${encodeURIComponent(f.name)}` })));
  });

  app.post("/api/files", upload.single("file"), (req: any, res: any) => {
    const store = getVaultStorage(req);
    if (!req.file) return res.status(400).json({ error: "No file" });
    const id = crypto.randomUUID();
    const result = store.saveFile(id, req.file.originalname, req.file.mimetype, req.file.buffer);
    res.status(201).json(result);
  });

  app.get("/api/files/:id/:filename", (req, res) => {
    const store = getVaultStorage(req);
    const file = store.getFile(req.params.id as string);
    if (!file) return res.status(404).end();
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.name}"`);
    res.send(file.buffer);
  });

  app.delete("/api/files/:id", (req, res) => {
    const store = getVaultStorage(req);
    const ok = store.deleteFile(req.params.id as string);
    if (!ok) return res.status(404).json({ error: "File not found" });
    res.json({ success: true });
  });

  // Create a note from a file
  app.post("/api/files/:id/create-note", (req, res) => {
    const store = getVaultStorage(req);
    const files = store.getFiles() as any[];
    const fileMeta = files.find((f: any) => f.id === req.params.id);
    if (!fileMeta) return res.status(404).json({ error: "File not found" });

    const isImage = fileMeta.mimeType?.startsWith("image/");
    const fileUrl = `/api/files/${fileMeta.id}/${encodeURIComponent(fileMeta.name)}`;
    let content = "";
    if (isImage) {
      content = `![${fileMeta.name}](${fileUrl})\n`;
    } else {
      content = `[${fileMeta.name}](${fileUrl})\n`;
    }

    const note = store.createNote({
      title: fileMeta.name.replace(/\.[^.]+$/, ""),
      content,
      folder: "/files",
      attachments: [fileUrl],
    });
    res.status(201).json(note);
  });

  // ============ SKILLS (vault-scoped) ============
  app.get("/api/skills", (req, res) => {
    const store = getVaultStorage(req);
    res.json(store.getSkills());
  });

  app.post("/api/skills", (req, res) => {
    const store = getVaultStorage(req);
    store.saveSkill(req.body);
    res.json({ success: true });
  });

  app.post("/api/skills/import", async (req, res) => {
    const store = getVaultStorage(req);
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "url is required" });

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return res.status(400).json({ error: "Only http/https URLs are allowed" });
    }

    try {
      const response = await fetch(parsedUrl.toString(), {
        headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
      });
      if (!response.ok) {
        return res.status(400).json({ error: `Failed to fetch skill (${response.status})` });
      }
      const raw = await response.text();
      if (raw.length > 1_000_000) {
        return res.status(400).json({ error: "Skill payload too large" });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: "URL did not return valid JSON" });
      }

      // Allow wrappers like { skill: {...} } and normalize optional fields
      const candidate = parsed?.skill ? parsed.skill : parsed;
      const normalized = {
        ...candidate,
        enabled: candidate?.enabled ?? true,
        builtin: false,
        filePath: null,
      };

      const validated = skillSchema.parse(normalized);
      store.saveSkill(validated);
      res.json({ success: true, skill: validated.name });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Failed to import skill" });
    }
  });

  app.put("/api/skills/:name", (req, res) => {
    const store = getVaultStorage(req);
    const skill = { ...req.body, name: req.params.name };
    store.saveSkill(skill);
    res.json({ success: true });
  });

  app.delete("/api/skills/:name", (req, res) => {
    const store = getVaultStorage(req);
    store.deleteSkill(req.params.name as string);
    res.json({ success: true });
  });

  app.get("/api/skills/categories", (_req, res) => {
    res.json([
      { id: "core", label: "Core", description: "Essential tools — always available" },
      { id: "browser", label: "Browser", description: "Web browsing and automation" },
      { id: "research", label: "Research", description: "Search and deep research" },
      { id: "writing", label: "Writing", description: "Drafting and summarization" },
      { id: "productivity", label: "Productivity", description: "Planning, code, and meetings" },
      { id: "custom", label: "Custom", description: "User-created skills" },
    ]);
  });

  // ============ STATS ============
  app.get("/api/stats", (req, res) => {
    const storage = getVaultStorage(req);
    res.json(storage.getStats());
  });

  app.post("/api/stats/reset", (req, res) => {
    const storage = getVaultStorage(req);
    storage.resetStats();
    res.json({ ok: true });
  });

  // ============ CONFIG (global) ============
  app.get("/api/config", (_req, res) => {
    res.json(vaultManager.getConfig());
  });

  app.patch("/api/config", async (req, res) => {
    const body = { ...(req.body || {}) };
    // Never persist impossible provider/model combinations.
    // Example bug: provider=grok with aiModel=gpt-4.1 → runtime 400 "Model not found".
    if (body.aiProvider && Object.prototype.hasOwnProperty.call(body, "aiModel")) {
      body.aiModel = body.aiModel ? pickModelForProvider(body.aiProvider, body.aiModel) : undefined;
    }
    const config = vaultManager.saveConfig(body);
    
    // If browser backend or MCP servers changed, re-init
    if (req.body.browserBackend !== undefined || req.body.mcpServers !== undefined) {
      try {
        await mcpManager.initFromConfig(config, false);
      } catch (e) {
        logError("[MCP] Failed to re-init after config change:", e);
      }
    }
    
    res.json(config);
  });

  // ============ MCP SERVERS ============
  // Get status of all MCP servers (connected + configured)
  app.get("/api/mcp/status", (_req, res) => {
    const config = vaultManager.getConfig();
    res.json(mcpManager.getStatus(config));
  });

  // Get available presets (known MCP server templates)
  app.get("/api/mcp/presets", (_req, res) => {
    res.json(mcpManager.getPresets());
  });

  // Get auth messages (device code flow, login URLs from MCP server stderr)
  app.get("/api/mcp/auth", (_req, res) => {
    res.json(mcpManager.authMessages);
  });

  // Clear auth messages
  app.delete("/api/mcp/auth", (_req, res) => {
    mcpManager.authMessages = [];
    res.json({ ok: true });
  });

  // Connect a specific MCP server by name
  app.post("/api/mcp/connect/:name", async (req, res) => {
    const serverName = req.params.name as string;
    const config = vaultManager.getConfig();
    try {
      const ok = await mcpManager.connectServer(serverName, config, false);
      res.json({ connected: ok, status: mcpManager.getStatus(config) });
    } catch (err: any) {
      res.status(500).json({ error: err.message, connected: false });
    }
  });

  // Disconnect a specific MCP server by name
  app.post("/api/mcp/disconnect/:name", async (req, res) => {
    const serverName = req.params.name as string;
    await mcpManager.disconnect(serverName);
    const config = vaultManager.getConfig();
    res.json({ connected: false, status: mcpManager.getStatus(config) });
  });

  // Legacy connect/disconnect endpoints (backward compat)
  app.post("/api/mcp/connect", async (_req, res) => {
    const config = vaultManager.getConfig();
    try {
      const ok = await mcpManager.initPlaywright(config, false);
      res.json({ connected: ok, status: mcpManager.getStatus(config) });
    } catch (err: any) {
      res.status(500).json({ error: err.message, connected: false });
    }
  });

  app.post("/api/mcp/disconnect", async (_req, res) => {
    await mcpManager.disconnect("playwright");
    res.json({ connected: false });
  });

  // Add an MCP server to config (from preset or custom)
  app.post("/api/mcp/servers", async (req, res) => {
    const { name, command, args, env } = req.body;
    if (!name) return res.status(400).json({ error: "Server name is required" });
    const config = vaultManager.getConfig();
    const mcpServers = { ...config.mcpServers };
    
    if (command) {
      // Custom server config
      mcpServers[name] = { command, args: args || [], env };
    } else {
      // Use preset defaults — store minimal config to mark it as "enabled"
      const { MCP_PRESETS } = await import("./mcp-client");
      const preset = MCP_PRESETS[name];
      if (preset) {
        mcpServers[name] = { command: preset.command, args: preset.args, env: preset.env };
      } else {
        return res.status(400).json({ error: `Unknown preset: ${name}. Provide command + args for custom servers.` });
      }
    }

    const updated = vaultManager.saveConfig({ mcpServers });
    res.json({ config: updated, status: mcpManager.getStatus(updated) });
  });

  // Remove an MCP server from config
  app.delete("/api/mcp/servers/:name", async (req, res) => {
    const serverName = req.params.name as string;
    // Disconnect first
    await mcpManager.disconnect(serverName);
    const config = vaultManager.getConfig();
    const mcpServers = { ...config.mcpServers };
    delete mcpServers[serverName];
    const updated = vaultManager.saveConfig({ mcpServers });
    res.json({ config: updated, status: mcpManager.getStatus(updated) });
  });

  // ============ SEARCH (vault-scoped) ============
  app.get("/api/search", (req, res) => {
    const store = getVaultStorage(req);
    const query = (req.query.q as string) || "";
    if (!query) return res.json([]);
    res.json(store.search(query));
  });

  // ============ API KEYS ============
  /** Get key status (which providers have keys, masked values) */
  app.get("/api/keys", (_req, res) => {
    const status = vaultManager.getKeyStatus();
    // Also return masked versions of set keys
    const masked: Record<string, { set: boolean; source: string; masked: string }> = {};
    for (const [provider, info] of Object.entries(status)) {
      if (info.set) {
        const key = vaultManager.resolveApiKey(provider as any);
        masked[provider] = {
          ...info,
          masked: key.length > 8 ? key.slice(0, 4) + "..." + key.slice(-4) : "****",
        };
      } else {
        masked[provider] = { ...info, masked: "" };
      }
    }
    res.json(masked);
  });

  /** Save API keys */
  app.patch("/api/keys", (req, res) => {
    const config = vaultManager.getConfig();
    const currentKeys = config.apiKeys || { openai: "", anthropic: "", grok: "", google: "" };
    const updates = req.body as Record<string, string>;
    const newKeys = { ...currentKeys };
    for (const [k, v] of Object.entries(updates)) {
      if (k in newKeys) {
        (newKeys as any)[k] = v;
      }
    }
    // Auto-detect provider from first key that's set
    let aiProvider = config.aiProvider;
    if (newKeys.anthropic) aiProvider = "anthropic";
    else if (newKeys.openai) aiProvider = "openai";
    else if (newKeys.grok) aiProvider = "grok";
    else if (newKeys.google) aiProvider = "google";

    vaultManager.saveConfig({ apiKeys: newKeys, aiProvider });
    res.json({ ok: true, aiProvider });
  });

  /** Verify an API key by making a lightweight call */
  app.post("/api/keys/verify", async (req, res) => {
    const { provider, key } = req.body as { provider: string; key: string };
    if (!provider || !key) return res.status(400).json({ valid: false, error: "Provider and key are required" });

    try {
      if (provider === "openai") {
        // List models — cheap, fast
        const resp = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        res.json({ valid: true });
      } else if (provider === "anthropic") {
        // Send a tiny completion request
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-opus-4-5",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          // 400 with "credit balance is too low" still means key is valid
          if (resp.status === 400 && body.includes("credit")) {
            res.json({ valid: true, warning: "Key is valid but account may have low credits" });
            return;
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        res.json({ valid: true });
      } else if (provider === "grok") {
        // xAI uses OpenAI-compatible API
        const resp = await fetch("https://api.x.ai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        res.json({ valid: true });
      } else if (provider === "google") {
        // Google AI Studio / Gemini
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        res.json({ valid: true });
      } else {
        res.status(400).json({ valid: false, error: "Unknown provider" });
      }
    } catch (err: any) {
      res.json({ valid: false, error: err.message || "Verification failed" });
    }
  });

  // ============ OPEN FOLDER (fallback for non-Electron) ============
  app.post("/api/open-folder", (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath || typeof folderPath !== "string") {
      return res.status(400).json({ error: "folderPath is required" });
    }
    try {
      const { exec } = require("child_process");
      const platform = process.platform;
      let cmd: string;
      if (platform === "win32") {
        cmd = `explorer "${folderPath.replace(/\//g, "\\\\")}"`;
      } else if (platform === "darwin") {
        cmd = `open "${folderPath}"`;
      } else {
        cmd = `xdg-open "${folderPath}"`;
      }
      exec(cmd, (err: any) => {
        if (err) {
          logError("[open-folder]", err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ ok: true });
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ INFO ============
  app.get("/api/info", (_req, res) => {
    const provider = vaultManager.detectProvider();
    const keyStatus = vaultManager.getKeyStatus();
    const hasAnyKey = Object.values(keyStatus).some(k => k.set);
    res.json({
      dataDir: vaultManager.getRootDir(),
      provider: hasAnyKey ? provider : "none",
      hasApiKey: hasAnyKey,
      keyStatus,
      version: APP_VERSION,
    });
  });

  // ============ AUTO-INIT MCP ============
  // Initialize all configured MCP servers at startup
  const config = vaultManager.getConfig();
  mcpManager.initFromConfig(config, false).then(() => {
    const status = mcpManager.getStatus(config);
    const connected = Object.entries(status).filter(([, s]) => s.connected).map(([n]) => n);
    if (connected.length > 0) {
      console.log(`[MCP] Servers ready: ${connected.join(", ")}`);
    } else {
      console.log("[MCP] No MCP servers connected (configure in Settings > General)");
    }
  }).catch(err => {
    logError("[MCP] Auto-init failed", err);
  });

  // ============ WEBSOCKET ============
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    let currentSessionId: string | null = null;

    ws.on("message", async (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === "join") {
          currentSessionId = data.sessionId;
          if (currentSessionId) {
            if (!activeAgents.has(currentSessionId)) {
              activeAgents.set(currentSessionId, { agent: null, ws: new Set() });
            }
            activeAgents.get(currentSessionId)!.ws.add(ws);
          }
        }

        // User answered a clarifying question — resolve the pending promise in the agent loop
        if (data.type === "clarification_response" && data.sessionId) {
          const resolve = pendingClarifications.get(data.sessionId);
          if (resolve) {
            pendingClarifications.delete(data.sessionId);
            resolve(data.answer || "");
          }
        }

        if (data.type === "chat" && data.sessionId && (data.message || data.images || data.files)) {
          const sessionId = data.sessionId;
          const vaultId = data.vaultId; // Frontend sends active vault ID
          currentSessionId = sessionId;

          const broadcast = (event: any) => {
            const entry = activeAgents.get(sessionId);
            if (entry) {
              const clients = Array.from(entry.ws);
              for (const client of clients) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify(event));
                }
              }
            }
          };

          // Resolve vault storage and settings for the agent
          const resolvedVaultId = vaultId || vaultManager.getDefaultVault().id;
          const store = vaultManager.getStorage(resolvedVaultId);
          const vaultSettings = vaultManager.getVaultSettings(resolvedVaultId);

          // Ensure all configured MCP servers are connected
          const globalConfig = vaultManager.getConfig();
          const headless = vaultSettings?.browserHeadless ?? false;
          mcpManager.initFromConfig(globalConfig, headless).catch(err => {
            logError("[MCP] Auto-connect on chat failed", err);
          });

          const context: ContextItem[] = data.context || [];

          // Add attached files as context items — extract text eagerly so the model
          // has content immediately without needing to call a tool with a filesystem path
          const attachedFiles: Array<{ id: string; name: string; mimeType: string }> = data.files || [];
          for (const f of attachedFiles) {
            const fileData = store.getFile(f.id);
            let content: string;
            if (!fileData) {
              content = `[File: ${f.name} — not found]`;
            } else {
              const ext = path.extname(f.name).toLowerCase();
              try {
                if ([".docx", ".doc"].includes(ext) || f.mimeType.includes("word") || f.mimeType.includes("officedocument.wordprocessing")) {
                  const mammoth = await import("mammoth");
                  const result = await mammoth.extractRawText({ buffer: fileData.buffer });
                  content = result.value.trim().slice(0, 30000) || `[${f.name}: document appears empty]`;
                } else if ([".xlsx", ".xls", ".ods"].includes(ext) || f.mimeType.includes("spreadsheet") || f.mimeType.includes("excel")) {
                  const XLSX = await import("xlsx");
                  const wb = XLSX.read(fileData.buffer);
                  const parts: string[] = [];
                  for (const sheetName of wb.SheetNames) {
                    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
                    parts.push(`=== Sheet: ${sheetName} ===\n${rows.map((r: any[]) => r.join("\t")).join("\n")}`);
                  }
                  content = parts.join("\n\n").slice(0, 30000);
                } else if (ext === ".pdf" || f.mimeType.includes("pdf")) {
                  const pdfParse = (await import("pdf-parse")).default;
                  const data = await pdfParse(fileData.buffer);
                  content = data.text.slice(0, 30000);
                } else if (f.mimeType.startsWith("image/")) {
                  content = `[Image file: ${f.name} — attached as visual content]`;
                } else {
                  content = store.getFileText(f.id) || `[File: ${f.name}]`;
                }
              } catch (extractErr: any) {
                logError(`[routes] failed to extract text from ${f.name}`, extractErr);
                content = `[File: ${f.name} — could not extract text: ${extractErr.message}]`;
              }
            }
            context.push({
              type: "file",
              title: f.name,
              content,
              id: f.id,
              mimeType: f.mimeType,
            });
          }

          // Merge newly attached files with files pinned from previous turns in this session.
          // This ensures that a file attached in message 1 is still in context in message 5.
          const session = store.getSession(sessionId);
          const previouslyPinned: ContextItem[] = (session?.pinnedContext as ContextItem[]) || [];

          // Add newly attached files to the pinned set (deduplicate by id or title)
          const newFileIds = new Set(context.filter(c => c.id).map(c => c.id));
          const newFileTitles = new Set(context.map(c => c.title));
          const retained = previouslyPinned.filter(p =>
            !newFileIds.has(p.id) && !newFileTitles.has(p.title)
          );
          const mergedContext: ContextItem[] = [...retained, ...context];

          // Save updated pinned context back to session (only file-type items)
          if (context.length > 0 || previouslyPinned.length !== retained.length) {
            store.updateSession(sessionId, { pinnedContext: mergedContext as any });
          }

          const agentSettings = globalConfig.agent || undefined;
          const agent = new Agent(sessionId, (event) => broadcast(event), mergedContext, store, vaultSettings, agentSettings);

          if (!activeAgents.has(sessionId)) {
            activeAgents.set(sessionId, { agent, ws: new Set([ws]) });
          } else {
            activeAgents.get(sessionId)!.agent = agent;
            activeAgents.get(sessionId)!.ws.add(ws);
          }

          broadcast({ type: "status", content: "thinking" });

          const images: Array<{ url: string; mediaType: string }> | undefined = data.images;
          const pinnedSkills: string[] = data.pinnedSkills || [];

          // askUserFn: pauses the loop and waits for the user to answer a clarifying question
          const askUserFn: AskUserFn = (question, choices) => {
            return new Promise<string>((resolve) => {
              pendingClarifications.set(sessionId, resolve);
              broadcast({
                id: crypto.randomUUID(),
                type: "question",
                content: question,
                metadata: { choices },
                timestamp: new Date().toISOString(),
              });
            });
          };

          try {
            await agent.run(data.message || "", images, pinnedSkills, askUserFn);
          } catch (err: any) {
            logError(`[Agent] session=${sessionId}`, err);
            broadcast({ type: "error", content: err.message });
          } finally {
            pendingClarifications.delete(sessionId); // clean up if agent errored while waiting
            broadcast({ type: "status", content: "done" });
          }
        }
      } catch (err) {
        logError("[WS] Message handling error:", err);
      }
    });

    ws.on("close", () => {
      if (currentSessionId && activeAgents.has(currentSessionId)) {
        activeAgents.get(currentSessionId)!.ws.delete(ws);
      }
    });
  });
}


