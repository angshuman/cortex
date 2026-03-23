import type { Express, Request } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { vaultManager, FileStorage } from "./storage";
import { Agent, type ContextItem } from "./agent";
import { mcpManager } from "./mcp-client";
import multer from "multer";
import path from "path";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const activeAgents = new Map<string, { agent: Agent | null; ws: Set<WebSocket> }>();

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
      res.json({ path: storage.getDataDir() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/vaults/:id", (req, res) => {
    const ok = vaultManager.deleteVault(req.params.id as string);
    if (!ok) return res.status(400).json({ error: "Cannot delete vault (last vault or not found)" });
    res.json({ success: true });
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

  app.post("/api/notes/:id/assets", upload.single("file"), (req: any, res: any) => {
    const store = getVaultStorage(req);
    if (!req.file) return res.status(400).json({ error: "No file" });
    const filename = `${Date.now()}-${req.file.originalname}`;
    const url = store.saveNoteAsset(req.params.id, filename, req.file.buffer);
    res.json({ url, filename });
  });

  app.get("/api/notes/:id/assets/:filename", (req, res) => {
    const store = getVaultStorage(req);
    const buffer = store.getNoteAsset(req.params.id as string, req.params.filename as string);
    if (!buffer) return res.status(404).end();
    const ext = path.extname(req.params.filename as string).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    };
    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.send(buffer);
  });

  app.post("/api/notes/inbox/dump", upload.single("file"), (req: any, res: any) => {
    const store = getVaultStorage(req);
    const title = req.body.title || `Dump ${new Date().toLocaleString()}`;
    let content = req.body.content || "";
    const note = store.createNote({ title, content, folder: "/inbox", tags: ["dump"] });
    if (req.file) {
      const filename = `${Date.now()}-${req.file.originalname}`;
      const url = store.saveNoteAsset(note.id, filename, req.file.buffer);
      content += `\n\n![${req.file.originalname}](${url})`;
      store.updateNote(note.id, { content, attachments: [url] });
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
    const store = getVaultStorage(req);
    const buffer = store.getChatAsset(req.params.filename as string);
    if (!buffer) return res.status(404).end();
    const ext = path.extname(req.params.filename as string).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
    };
    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
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

  // ============ CONFIG (global) ============
  app.get("/api/config", (_req, res) => {
    res.json(vaultManager.getConfig());
  });

  app.patch("/api/config", async (req, res) => {
    const config = vaultManager.saveConfig(req.body);
    
    // If browser backend or MCP servers changed, re-init
    if (req.body.browserBackend !== undefined || req.body.mcpServers !== undefined) {
      try {
        await mcpManager.initFromConfig(config, false);
      } catch (e) {
        console.error("[MCP] Failed to re-init after config change:", e);
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
    if (newKeys.anthropic) aiProvider = "claude";
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
            model: "claude-sonnet-4-20250514",
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
      version: "2.0.0",
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
    console.error("[MCP] Auto-init failed:", err.message);
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

        if (data.type === "chat" && data.sessionId && (data.message || data.images)) {
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
            console.error("[MCP] Auto-connect on chat failed:", err.message);
          });

          const context: ContextItem[] = data.context || [];
          const agentSettings = globalConfig.agent || undefined;
          const agent = new Agent(sessionId, (event) => broadcast(event), context, store, vaultSettings, agentSettings);

          if (!activeAgents.has(sessionId)) {
            activeAgents.set(sessionId, { agent, ws: new Set([ws]) });
          } else {
            activeAgents.get(sessionId)!.agent = agent;
            activeAgents.get(sessionId)!.ws.add(ws);
          }

          broadcast({ type: "status", content: "thinking" });

          const images: Array<{ url: string; mediaType: string }> | undefined = data.images;

          try {
            await agent.run(data.message || "", images);
          } catch (err: any) {
            broadcast({ type: "error", content: err.message });
          } finally {
            broadcast({ type: "status", content: "done" });
          }
        }
      } catch (err) {
        console.error("[WS] Message handling error:", err);
      }
    });

    ws.on("close", () => {
      if (currentSessionId && activeAgents.has(currentSessionId)) {
        activeAgents.get(currentSessionId)!.ws.delete(ws);
      }
    });
  });
}
