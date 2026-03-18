import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import type { Note, InsertNote, Task, InsertTask, ChatSession, ChatEvent, Skill, Config, SearchResult } from "@shared/schema";

const DEFAULT_DATA_DIR = path.join(process.cwd(), ".cortex-data");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

function writeJson(filePath: string, data: any) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export class FileStorage {
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || process.env.CORTEX_DATA_DIR || DEFAULT_DATA_DIR;
    this.init();
  }

  private init() {
    ensureDir(this.dataDir);
    ensureDir(path.join(this.dataDir, "notes"));
    ensureDir(path.join(this.dataDir, "notes", "inbox"));
    ensureDir(path.join(this.dataDir, "notes", "assets"));
    ensureDir(path.join(this.dataDir, "tasks"));
    ensureDir(path.join(this.dataDir, "chat", "sessions"));
    ensureDir(path.join(this.dataDir, "skills"));
    ensureDir(path.join(this.dataDir, "search"));

    // Initialize default files if not present
    const tasksFile = path.join(this.dataDir, "tasks", "tasks.json");
    if (!fs.existsSync(tasksFile)) writeJson(tasksFile, []);
    const configFile = path.join(this.dataDir, "config.json");
    if (!fs.existsSync(configFile)) writeJson(configFile, {
      dataDir: this.dataDir,
      aiProvider: this.detectProvider(),
      vectorSearch: "local",
      browserBackend: "none",
      mcpServers: {},
      theme: "system",
    });
    this.initBuiltinSkills();
  }

  getDataDir(): string { return this.dataDir; }

  private detectProvider(): string {
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith("sk-ant")) return "claude";
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith("sk-")) return "openai";
    if (process.env.GROK_API_KEY) return "grok";
    return "claude";
  }

  // ============ CONFIG ============
  getConfig(): Config {
    return readJson(path.join(this.dataDir, "config.json"), {} as Config);
  }

  saveConfig(config: Partial<Config>): Config {
    const existing = this.getConfig();
    const merged = { ...existing, ...config };
    writeJson(path.join(this.dataDir, "config.json"), merged);
    return merged;
  }

  // ============ NOTES ============
  private notesIndexPath() { return path.join(this.dataDir, "notes", "index.json"); }

  private getNotesIndex(): Note[] {
    return readJson(this.notesIndexPath(), []);
  }

  private saveNotesIndex(notes: Note[]) {
    writeJson(this.notesIndexPath(), notes);
  }

  getNotes(): Note[] {
    return this.getNotesIndex();
  }

  getNote(id: string): Note | undefined {
    return this.getNotesIndex().find(n => n.id === id);
  }

  createNote(input: InsertNote): Note {
    const now = new Date().toISOString();
    const note: Note = {
      id: uuid(),
      title: input.title,
      content: input.content,
      folder: input.folder || "/",
      tags: input.tags || [],
      attachments: input.attachments || [],
      pinned: input.pinned || false,
      createdAt: now,
      updatedAt: now,
    };
    const notes = this.getNotesIndex();
    notes.push(note);
    this.saveNotesIndex(notes);

    // Also save markdown file for portability
    const mdDir = path.join(this.dataDir, "notes", "files", note.folder);
    ensureDir(mdDir);
    const safeName = note.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || note.id;
    fs.writeFileSync(path.join(mdDir, `${safeName}.md`), note.content, "utf-8");

    return note;
  }

  updateNote(id: string, updates: Partial<Note>): Note | undefined {
    const notes = this.getNotesIndex();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return undefined;
    notes[idx] = { ...notes[idx], ...updates, updatedAt: new Date().toISOString() };
    this.saveNotesIndex(notes);
    return notes[idx];
  }

  deleteNote(id: string): boolean {
    const notes = this.getNotesIndex();
    const filtered = notes.filter(n => n.id !== id);
    if (filtered.length === notes.length) return false;
    this.saveNotesIndex(filtered);
    return true;
  }

  getNoteFolders(): string[] {
    const notes = this.getNotesIndex();
    const folders = new Set(notes.map(n => n.folder));
    folders.add("/");
    folders.add("/inbox");
    return Array.from(folders).sort();
  }

  saveNoteAsset(noteId: string, filename: string, buffer: Buffer): string {
    const assetsDir = path.join(this.dataDir, "notes", "assets", noteId);
    ensureDir(assetsDir);
    const filePath = path.join(assetsDir, filename);
    fs.writeFileSync(filePath, buffer);
    return `/api/notes/${noteId}/assets/${filename}`;
  }

  getNoteAsset(noteId: string, filename: string): Buffer | null {
    const filePath = path.join(this.dataDir, "notes", "assets", noteId, filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  // ============ CHAT ASSETS (images pasted into chat) ============
  saveChatAsset(filename: string, buffer: Buffer): string {
    const assetsDir = path.join(this.dataDir, "chat", "assets");
    ensureDir(assetsDir);
    const filePath = path.join(assetsDir, filename);
    fs.writeFileSync(filePath, buffer);
    return `/api/chat/assets/${filename}`;
  }

  getChatAsset(filename: string): Buffer | null {
    const filePath = path.join(this.dataDir, "chat", "assets", filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  getChatAssetPath(filename: string): string {
    return path.join(this.dataDir, "chat", "assets", filename);
  }

  // ============ TASKS ============
  private tasksPath() { return path.join(this.dataDir, "tasks", "tasks.json"); }

  getTasks(): Task[] {
    return readJson(this.tasksPath(), []);
  }

  getTask(id: string): Task | undefined {
    return this.getTasks().find(t => t.id === id);
  }

  createTask(input: InsertTask): Task {
    const now = new Date().toISOString();
    const tasks = this.getTasks();
    const task: Task = {
      id: uuid(),
      title: input.title,
      description: input.description || "",
      status: input.status || "todo",
      priority: input.priority || "medium",
      parentId: input.parentId || null,
      tags: input.tags || [],
      dueDate: input.dueDate || null,
      order: input.order ?? tasks.length,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    tasks.push(task);
    writeJson(this.tasksPath(), tasks);
    return task;
  }

  updateTask(id: string, updates: Partial<Task>): Task | undefined {
    const tasks = this.getTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return undefined;
    if (updates.status === "done" && tasks[idx].status !== "done") {
      updates.completedAt = new Date().toISOString();
    }
    tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
    writeJson(this.tasksPath(), tasks);
    return tasks[idx];
  }

  deleteTask(id: string): boolean {
    const tasks = this.getTasks();
    const filtered = tasks.filter(t => t.id !== id);
    if (filtered.length === tasks.length) return false;
    writeJson(this.tasksPath(), filtered);
    return true;
  }

  reorderTasks(taskIds: string[]): void {
    const tasks = this.getTasks();
    taskIds.forEach((id, i) => {
      const t = tasks.find(t => t.id === id);
      if (t) t.order = i;
    });
    writeJson(this.tasksPath(), tasks);
  }

  // ============ CHAT ============
  private sessionPath(id: string) { return path.join(this.dataDir, "chat", "sessions", `${id}.json`); }
  private sessionsIndexPath() { return path.join(this.dataDir, "chat", "sessions-index.json"); }

  private getSessionsIndex(): Array<{ id: string; title: string; status: string; createdAt: string; updatedAt: string }> {
    return readJson(this.sessionsIndexPath(), []);
  }

  getSessions(): Array<{ id: string; title: string; status: string; createdAt: string; updatedAt: string }> {
    return this.getSessionsIndex().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getSession(id: string): ChatSession | undefined {
    return readJson(this.sessionPath(id), undefined as unknown as ChatSession);
  }

  createSession(title?: string): ChatSession {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: uuid(),
      title: title || "New Chat",
      events: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    writeJson(this.sessionPath(session.id), session);
    const index = this.getSessionsIndex();
    index.push({ id: session.id, title: session.title, status: "active", createdAt: now, updatedAt: now });
    writeJson(this.sessionsIndexPath(), index);
    return session;
  }

  addChatEvent(sessionId: string, event: ChatEvent): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    session.events.push(event);
    session.updatedAt = new Date().toISOString();
    writeJson(this.sessionPath(sessionId), session);
  }

  updateSession(id: string, updates: Partial<ChatSession>): void {
    const session = this.getSession(id);
    if (!session) return;
    Object.assign(session, updates, { updatedAt: new Date().toISOString() });
    writeJson(this.sessionPath(id), session);
    // Update index
    const index = this.getSessionsIndex();
    const idx = index.findIndex(s => s.id === id);
    if (idx !== -1) {
      if (updates.title) index[idx].title = updates.title;
      if (updates.status) index[idx].status = updates.status;
      index[idx].updatedAt = session.updatedAt;
      writeJson(this.sessionsIndexPath(), index);
    }
  }

  deleteSession(id: string): boolean {
    const filePath = this.sessionPath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const index = this.getSessionsIndex();
    const filtered = index.filter(s => s.id !== id);
    writeJson(this.sessionsIndexPath(), filtered);
    return true;
  }

  // ============ SKILLS ============
  private skillsPath() { return path.join(this.dataDir, "skills", "skills.json"); }

  getSkills(): Skill[] {
    return readJson(this.skillsPath(), []);
  }

  saveSkill(skill: Skill): void {
    const skills = this.getSkills();
    const idx = skills.findIndex(s => s.name === skill.name);
    if (idx !== -1) skills[idx] = skill;
    else skills.push(skill);
    writeJson(this.skillsPath(), skills);
  }

  deleteSkill(name: string): boolean {
    const skills = this.getSkills();
    const filtered = skills.filter(s => s.name !== name);
    if (filtered.length === skills.length) return false;
    writeJson(this.skillsPath(), filtered);
    return true;
  }

  private initBuiltinSkills() {
    const skills = this.getSkills();
    const builtins: Skill[] = [
      {
        name: "note-taker",
        description: "Create, read, update and search notes",
        version: "1.0.0",
        instructions: "You can manage notes for the user. Use the note tools to create, read, update, and search notes. Notes support markdown formatting and can have images attached.",
        tools: [
          { name: "create_note", description: "Create a new note", parameters: [
            { name: "title", type: "string", description: "Note title", required: true },
            { name: "content", type: "string", description: "Markdown content", required: true },
            { name: "folder", type: "string", description: "Folder path (e.g. /projects)", required: false },
            { name: "tags", type: "string[]", description: "Tags for the note", required: false },
          ]},
          { name: "read_note", description: "Read a note by ID", parameters: [
            { name: "id", type: "string", description: "Note ID", required: true },
          ]},
          { name: "list_notes", description: "List all notes, optionally filtered by folder", parameters: [
            { name: "folder", type: "string", description: "Filter by folder path", required: false },
          ]},
          { name: "update_note", description: "Update an existing note", parameters: [
            { name: "id", type: "string", description: "Note ID", required: true },
            { name: "title", type: "string", description: "New title", required: false },
            { name: "content", type: "string", description: "New content", required: false },
          ]},
        ],
        enabled: true,
        builtin: true,
      },
      {
        name: "task-manager",
        description: "Create, update, and manage tasks and subtasks",
        version: "1.0.0",
        instructions: "You can manage tasks for the user. Tasks have statuses (todo, in_progress, done, archived), priorities (low, medium, high, urgent), and can be nested via parentId.",
        tools: [
          { name: "create_task", description: "Create a new task", parameters: [
            { name: "title", type: "string", description: "Task title", required: true },
            { name: "description", type: "string", description: "Task description", required: false },
            { name: "priority", type: "string", description: "low|medium|high|urgent", required: false },
            { name: "parentId", type: "string", description: "Parent task ID for subtasks", required: false },
            { name: "dueDate", type: "string", description: "Due date ISO string", required: false },
          ]},
          { name: "list_tasks", description: "List all tasks", parameters: [
            { name: "status", type: "string", description: "Filter by status", required: false },
          ]},
          { name: "update_task", description: "Update a task", parameters: [
            { name: "id", type: "string", description: "Task ID", required: true },
            { name: "status", type: "string", description: "New status", required: false },
            { name: "title", type: "string", description: "New title", required: false },
            { name: "priority", type: "string", description: "New priority", required: false },
          ]},
          { name: "complete_task", description: "Mark a task as done", parameters: [
            { name: "id", type: "string", description: "Task ID", required: true },
          ]},
        ],
        enabled: true,
        builtin: true,
      },
      {
        name: "web-search",
        description: "Search the web and fetch URLs",
        version: "1.1.0",
        instructions: "You can search the web and fetch URLs. web_search queries Hacker News for stories. web_fetch retrieves any URL (APIs, pages). Use web_fetch for specific APIs like https://hacker-news.firebaseio.com/v0/topstories.json or any public endpoint. For HackerNews top stories, prefer fetching the API directly.",
        tools: [
          { name: "web_search", description: "Search Hacker News stories by keyword", parameters: [
            { name: "query", type: "string", description: "Search query", required: true },
          ]},
          { name: "web_fetch", description: "Fetch a URL and return its contents (JSON APIs, web pages, etc.)", parameters: [
            { name: "url", type: "string", description: "URL to fetch", required: true },
          ]},
        ],
        enabled: true,
        builtin: true,
      },
      {
        name: "browser-use",
        description: "Browse websites and interact with web pages via MCP",
        version: "1.0.0",
        instructions: "You can browse the web using a real browser. You can navigate to URLs, click elements, type text, take screenshots, and extract content from web pages.",
        tools: [
          { name: "browser_navigate", description: "Navigate to a URL", parameters: [
            { name: "url", type: "string", description: "URL to navigate to", required: true },
          ]},
          { name: "browser_screenshot", description: "Take a screenshot of the current page", parameters: [] },
          { name: "browser_click", description: "Click an element on the page", parameters: [
            { name: "element", type: "string", description: "Element description or selector", required: true },
          ]},
          { name: "browser_type", description: "Type text into an input", parameters: [
            { name: "element", type: "string", description: "Element description or selector", required: true },
            { name: "text", type: "string", description: "Text to type", required: true },
          ]},
          { name: "browser_snapshot", description: "Get the accessibility tree of the current page", parameters: [] },
        ],
        enabled: true,
        builtin: true,
      },
    ];

    for (const b of builtins) {
      const existing = skills.findIndex(s => s.name === b.name);
      if (existing === -1) {
        skills.push(b);
      } else if (skills[existing].builtin && skills[existing].version !== b.version) {
        // Update built-in skills when version changes
        skills[existing] = b;
      }
    }
    writeJson(this.skillsPath(), skills);
  }

  // ============ SEARCH ============
  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const q = query.toLowerCase();

    // Search notes
    for (const note of this.getNotes()) {
      const titleMatch = note.title.toLowerCase().includes(q);
      const contentMatch = note.content.toLowerCase().includes(q);
      if (titleMatch || contentMatch) {
        let snippet = "";
        if (contentMatch) {
          const idx = note.content.toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 60);
          const end = Math.min(note.content.length, idx + query.length + 60);
          snippet = (start > 0 ? "..." : "") + note.content.slice(start, end) + (end < note.content.length ? "..." : "");
        } else {
          snippet = note.content.slice(0, 120);
        }
        results.push({
          id: note.id,
          type: "note",
          title: note.title,
          snippet,
          score: titleMatch ? 1.0 : 0.7,
          path: note.folder,
        });
      }
    }

    // Search tasks
    for (const task of this.getTasks()) {
      const titleMatch = task.title.toLowerCase().includes(q);
      const descMatch = task.description.toLowerCase().includes(q);
      if (titleMatch || descMatch) {
        results.push({
          id: task.id,
          type: "task",
          title: task.title,
          snippet: task.description.slice(0, 120),
          score: titleMatch ? 1.0 : 0.6,
        });
      }
    }

    // Search chat sessions
    for (const sess of this.getSessionsIndex()) {
      if (sess.title.toLowerCase().includes(q)) {
        results.push({
          id: sess.id,
          type: "chat",
          title: sess.title,
          snippet: `Chat session from ${new Date(sess.createdAt).toLocaleDateString()}`,
          score: 0.5,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

export const storage = new FileStorage();
