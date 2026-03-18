import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { Agent, type ContextItem } from "./agent";
import multer from "multer";
import path from "path";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const activeAgents = new Map<string, { agent: Agent | null; ws: Set<WebSocket> }>();

export function registerRoutes(server: Server, app: Express) {
  // ============ NOTES ============
  app.get("/api/notes", (_req, res) => {
    res.json(storage.getNotes());
  });

  app.get("/api/notes/folders", (_req, res) => {
    res.json(storage.getNoteFolders());
  });

  app.get("/api/notes/:id", (req, res) => {
    const note = storage.getNote(req.params.id as string);
    if (!note) return res.status(404).json({ error: "Not found" });
    res.json(note);
  });

  app.post("/api/notes", (req, res) => {
    const note = storage.createNote(req.body);
    res.status(201).json(note);
  });

  app.patch("/api/notes/:id", (req, res) => {
    const note = storage.updateNote(req.params.id as string, req.body);
    if (!note) return res.status(404).json({ error: "Not found" });
    res.json(note);
  });

  app.delete("/api/notes/:id", (req, res) => {
    const ok = storage.deleteNote(req.params.id as string);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  app.post("/api/notes/:id/assets", upload.single("file"), (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const filename = `${Date.now()}-${req.file.originalname}`;
    const url = storage.saveNoteAsset(req.params.id, filename, req.file.buffer);
    res.json({ url, filename });
  });

  app.get("/api/notes/:id/assets/:filename", (req, res) => {
    const buffer = storage.getNoteAsset(req.params.id as string, req.params.filename as string);
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
    const title = req.body.title || `Dump ${new Date().toLocaleString()}`;
    let content = req.body.content || "";
    const note = storage.createNote({ title, content, folder: "/inbox", tags: ["dump"] });
    if (req.file) {
      const filename = `${Date.now()}-${req.file.originalname}`;
      const url = storage.saveNoteAsset(note.id, filename, req.file.buffer);
      content += `\n\n![${req.file.originalname}](${url})`;
      storage.updateNote(note.id, { content, attachments: [url] });
    }
    res.status(201).json(note);
  });

  // ============ TASKS ============
  app.get("/api/tasks", (_req, res) => {
    res.json(storage.getTasks());
  });

  app.get("/api/tasks/:id", (req, res) => {
    const task = storage.getTask(req.params.id as string);
    if (!task) return res.status(404).json({ error: "Not found" });
    res.json(task);
  });

  app.post("/api/tasks", (req, res) => {
    const task = storage.createTask(req.body);
    res.status(201).json(task);
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const task = storage.updateTask(req.params.id as string, req.body);
    if (!task) return res.status(404).json({ error: "Not found" });
    res.json(task);
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const ok = storage.deleteTask(req.params.id as string);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  app.post("/api/tasks/reorder", (req, res) => {
    storage.reorderTasks(req.body.taskIds);
    res.json({ success: true });
  });

  // ============ CHAT SESSIONS ============
  app.get("/api/chat/sessions", (_req, res) => {
    res.json(storage.getSessions());
  });

  app.post("/api/chat/sessions", (req, res) => {
    const session = storage.createSession(req.body.title);
    res.status(201).json(session);
  });

  app.get("/api/chat/sessions/:id", (req, res) => {
    const session = storage.getSession(req.params.id as string);
    if (!session) return res.status(404).json({ error: "Not found" });
    res.json(session);
  });

  app.delete("/api/chat/sessions/:id", (req, res) => {
    storage.deleteSession(req.params.id as string);
    res.json({ success: true });
  });

  // ============ CHAT ASSETS (pasted images) ============
  app.post("/api/chat/assets", upload.single("file"), (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const url = storage.saveChatAsset(filename, req.file.buffer);
    res.json({ url, filename });
  });

  app.get("/api/chat/assets/:filename", (req, res) => {
    const buffer = storage.getChatAsset(req.params.filename as string);
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

  // ============ SKILLS ============
  app.get("/api/skills", (_req, res) => {
    res.json(storage.getSkills());
  });

  app.post("/api/skills", (req, res) => {
    storage.saveSkill(req.body);
    res.json({ success: true });
  });

  app.delete("/api/skills/:name", (req, res) => {
    storage.deleteSkill(req.params.name as string);
    res.json({ success: true });
  });

  // ============ CONFIG ============
  app.get("/api/config", (_req, res) => {
    res.json(storage.getConfig());
  });

  app.patch("/api/config", (req, res) => {
    const config = storage.saveConfig(req.body);
    res.json(config);
  });

  // ============ SEARCH ============
  app.get("/api/search", (req, res) => {
    const query = (req.query.q as string) || "";
    if (!query) return res.json([]);
    res.json(storage.search(query));
  });

  // ============ INFO ============
  app.get("/api/info", (_req, res) => {
    res.json({
      dataDir: storage.getDataDir(),
      provider: process.env.ANTHROPIC_API_KEY ? "claude" : process.env.OPENAI_API_KEY ? "openai" : process.env.GROK_API_KEY ? "grok" : "none",
      version: "1.0.0",
    });
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

          const context: ContextItem[] = data.context || [];
          const agent = new Agent(sessionId, (event) => broadcast(event), context);

          if (!activeAgents.has(sessionId)) {
            activeAgents.set(sessionId, { agent, ws: new Set([ws]) });
          } else {
            activeAgents.get(sessionId)!.agent = agent;
            activeAgents.get(sessionId)!.ws.add(ws);
          }

          broadcast({ type: "status", content: "thinking" });

          // Pass images array if present
          const images: Array<{ url: string; mediaType: string }> | undefined = data.images;

          try {
            await agent.run(data.message || "", images);
            broadcast({ type: "status", content: "done" });
          } catch (err: any) {
            broadcast({ type: "error", content: err.message });
          }
        }
      } catch (_err) {
        // ignore
      }
    });

    ws.on("close", () => {
      if (currentSessionId && activeAgents.has(currentSessionId)) {
        activeAgents.get(currentSessionId)!.ws.delete(ws);
      }
    });
  });
}
