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

  app.delete("/api/skills/:name", (req, res) => {
    const store = getVaultStorage(req);
    store.deleteSkill(req.params.name as string);
    res.json({ success: true });
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

  // ============ INFO ============
  app.get("/api/info", (_req, res) => {
    res.json({
      dataDir: vaultManager.getRootDir(),
      provider: process.env.ANTHROPIC_API_KEY ? "claude" : process.env.OPENAI_API_KEY ? "openai" : process.env.GROK_API_KEY ? "grok" : "none",
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
