import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import type { Note, InsertNote, Task, InsertTask, ChatSession, ChatEvent, Skill, Config, SearchResult, Vault, InsertVault, VaultSettings } from "@shared/schema";

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "vault";
}

/**
 * FileStorage: operates within a single vault directory.
 * All notes, tasks, chat, skills are scoped to this directory.
 */
export class FileStorage {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.initVaultDirs();
  }

  private initVaultDirs() {
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
    this.initBuiltinSkills();
  }

  getDataDir(): string { return this.dataDir; }

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
    // URL includes vault prefix — will be handled by routes
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

  // ============ FILES (user-uploaded file storage) ============
  private filesDir() { return path.join(this.dataDir, "files"); }
  private filesMetaPath() { return path.join(this.filesDir(), "_meta.json"); }

  getFiles(): Array<{ id: string; name: string; size: number; mimeType: string; createdAt: string }> {
    return readJson(this.filesMetaPath(), []);
  }

  saveFile(id: string, originalName: string, mimeType: string, buffer: Buffer): { id: string; name: string; size: number; mimeType: string; createdAt: string; url: string } {
    const dir = this.filesDir();
    ensureDir(dir);
    const ext = path.extname(originalName);
    const storedName = `${id}${ext}`;
    fs.writeFileSync(path.join(dir, storedName), buffer);
    const meta = {
      id,
      name: originalName,
      storedName,
      size: buffer.length,
      mimeType,
      createdAt: new Date().toISOString(),
    };
    const files = this.getFiles() as any[];
    files.push(meta);
    writeJson(this.filesMetaPath(), files);
    return { ...meta, url: `/api/files/${id}/${encodeURIComponent(originalName)}` };
  }

  getFile(id: string): { buffer: Buffer; name: string; mimeType: string } | null {
    const files = readJson(this.filesMetaPath(), []) as any[];
    const meta = files.find((f: any) => f.id === id);
    if (!meta) return null;
    const filePath = path.join(this.filesDir(), meta.storedName);
    if (!fs.existsSync(filePath)) return null;
    return { buffer: fs.readFileSync(filePath), name: meta.name, mimeType: meta.mimeType };
  }

  deleteFile(id: string): boolean {
    const files = readJson(this.filesMetaPath(), []) as any[];
    const idx = files.findIndex((f: any) => f.id === id);
    if (idx === -1) return false;
    const meta = files[idx];
    const filePath = path.join(this.filesDir(), meta.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    files.splice(idx, 1);
    writeJson(this.filesMetaPath(), files);
    return true;
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
        skills[existing] = b;
      }
    }
    writeJson(this.skillsPath(), skills);
  }

  // ============ SEARCH ============
  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const q = query.toLowerCase();

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

    for (const sess of this.getSessions()) {
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

/**
 * VaultManager: top-level manager that handles vault CRUD
 * and provides per-vault FileStorage instances.
 * 
 * Filesystem layout:
 *   .cortex-data/
 *     config.json          (global config)
 *     vaults.json          (vault registry)
 *     vaults/
 *       default/           (each vault is a folder)
 *         notes/
 *         tasks/
 *         chat/
 *         skills/
 *         search/
 *       work/
 *         ...
 */
export class VaultManager {
  private rootDir: string;
  private vaultsDir: string;
  private storageCache = new Map<string, FileStorage>();

  constructor(rootDir?: string) {
    this.rootDir = rootDir || process.env.CORTEX_DATA_DIR || DEFAULT_DATA_DIR;
    this.vaultsDir = path.join(this.rootDir, "vaults");
    ensureDir(this.rootDir);
    ensureDir(this.vaultsDir);
    this.migrate();
  }

  getRootDir(): string { return this.rootDir; }

  // ============ VAULT CRUD ============
  private vaultsIndexPath() { return path.join(this.rootDir, "vaults.json"); }

  private getVaultsIndex(): Vault[] {
    return readJson(this.vaultsIndexPath(), []);
  }

  private saveVaultsIndex(vaults: Vault[]) {
    writeJson(this.vaultsIndexPath(), vaults);
  }

  getVaults(): Vault[] {
    return this.getVaultsIndex().sort((a, b) => a.name.localeCompare(b.name));
  }

  getVault(id: string): Vault | undefined {
    return this.getVaultsIndex().find(v => v.id === id);
  }

  getVaultBySlug(slug: string): Vault | undefined {
    return this.getVaultsIndex().find(v => v.slug === slug);
  }

  createVault(input: InsertVault): Vault {
    const now = new Date().toISOString();
    let slug = slugify(input.name);
    // Ensure unique slug
    const existing = this.getVaultsIndex();
    let suffix = 0;
    let candidateSlug = slug;
    while (existing.some(v => v.slug === candidateSlug)) {
      suffix++;
      candidateSlug = `${slug}-${suffix}`;
    }
    slug = candidateSlug;

    const settings: VaultSettings = {
      folderPath: input.settings?.folderPath ?? null,
      browserHeadless: input.settings?.browserHeadless ?? false,
      aiModel: input.settings?.aiModel ?? null,
    };

    const vault: Vault = {
      id: uuid(),
      name: input.name,
      slug,
      icon: input.icon || "\ud83d\udcc1",
      color: input.color || "#6366f1",
      settings,
      createdAt: now,
      updatedAt: now,
    };

    existing.push(vault);
    this.saveVaultsIndex(existing);

    // Create the vault directory and initialize storage
    const vaultDir = this.resolveVaultDir(vault);
    ensureDir(vaultDir);
    this.getStorage(vault.id); // triggers init

    return vault;
  }

  updateVault(id: string, updates: Partial<Pick<Vault, "name" | "icon" | "color" | "settings">>): Vault | undefined {
    const vaults = this.getVaultsIndex();
    const idx = vaults.findIndex(v => v.id === id);
    if (idx === -1) return undefined;

    const oldSlug = vaults[idx].slug;
    let newSlug = oldSlug;

    // If the external folderPath is changing, clear cached storage
    const oldFolderPath = vaults[idx].settings?.folderPath;
    const newFolderPath = updates.settings?.folderPath;
    if (newFolderPath !== undefined && newFolderPath !== oldFolderPath) {
      this.storageCache.delete(id);
    }

    if (updates.name && updates.name !== vaults[idx].name) {
      newSlug = slugify(updates.name);
      let suffix = 0;
      let candidateSlug = newSlug;
      while (vaults.some(v => v.slug === candidateSlug && v.id !== id)) {
        suffix++;
        candidateSlug = `${newSlug}-${suffix}`;
      }
      newSlug = candidateSlug;

      // Rename folder on disk (only if using default vault dir, not external path)
      if (!oldFolderPath) {
        const oldDir = path.join(this.vaultsDir, oldSlug);
        const newDir = path.join(this.vaultsDir, newSlug);
        if (fs.existsSync(oldDir) && oldDir !== newDir) {
          fs.renameSync(oldDir, newDir);
        }
      }

      // Clear cached storage for old slug
      this.storageCache.delete(id);
    }

    // Merge settings (don't overwrite entire settings if only updating one field)
    const mergedSettings = updates.settings
      ? { ...(vaults[idx].settings || { folderPath: null, browserHeadless: false, aiModel: null }), ...updates.settings }
      : vaults[idx].settings;

    vaults[idx] = {
      ...vaults[idx],
      ...updates,
      settings: mergedSettings,
      slug: newSlug,
      updatedAt: new Date().toISOString(),
    };
    this.saveVaultsIndex(vaults);
    return vaults[idx];
  }

  deleteVault(id: string): boolean {
    const vaults = this.getVaultsIndex();
    const vault = vaults.find(v => v.id === id);
    if (!vault) return false;
    if (vaults.length <= 1) return false; // Can't delete last vault

    const filtered = vaults.filter(v => v.id !== id);
    this.saveVaultsIndex(filtered);
    this.storageCache.delete(id);

    // Optionally: we keep the folder on disk for safety (user can manually delete)
    // To truly delete: fs.rmSync(path.join(this.vaultsDir, vault.slug), { recursive: true, force: true });
    return true;
  }

  // ============ STORAGE ACCESS ============

  /**
   * Resolve the filesystem directory for a vault.
   * If vault has a folderPath in settings, use that external path.
   * Otherwise fall back to .cortex-data/vaults/<slug>/
   */
  private resolveVaultDir(vault: Vault): string {
    if (vault.settings?.folderPath) {
      return vault.settings.folderPath;
    }
    return path.join(this.vaultsDir, vault.slug);
  }

  getStorage(vaultId: string): FileStorage {
    if (this.storageCache.has(vaultId)) {
      return this.storageCache.get(vaultId)!;
    }

    const vault = this.getVault(vaultId);
    if (!vault) {
      // Fallback to first vault
      const vaults = this.getVaults();
      if (vaults.length > 0) {
        return this.getStorage(vaults[0].id);
      }
      throw new Error("No vaults exist");
    }

    const vaultDir = this.resolveVaultDir(vault);
    const storage = new FileStorage(vaultDir);
    this.storageCache.set(vaultId, storage);
    return storage;
  }

  /** Get settings for a specific vault */
  getVaultSettings(vaultId: string): VaultSettings {
    const vault = this.getVault(vaultId);
    if (!vault) return { folderPath: null, browserHeadless: false, aiModel: null };
    return vault.settings || { folderPath: null, browserHeadless: false, aiModel: null };
  }

  getDefaultVault(): Vault {
    const vaults = this.getVaults();
    return vaults[0]; // First vault is the default
  }

  // ============ CONFIG (global, not per-vault) ============

  /**
   * Resolve an API key for a given provider.
   * Priority: config.json apiKeys > environment variable.
   */
  resolveApiKey(provider: "openai" | "anthropic" | "grok" | "google"): string {
    const config = this.getConfig();
    const fromConfig = config.apiKeys?.[provider] || "";
    if (fromConfig) return fromConfig;
    // Fallback to env vars
    const envMap: Record<string, string> = {
      openai: process.env.OPENAI_API_KEY || "",
      anthropic: process.env.ANTHROPIC_API_KEY || "",
      grok: process.env.GROK_API_KEY || "",
      google: process.env.GOOGLE_API_KEY || "",
    };
    return envMap[provider] || "";
  }

  /** Check which providers have a valid key (from config or env). */
  getKeyStatus(): Record<string, { set: boolean; source: "config" | "env" | "none" }> {
    const config = this.getConfig();
    const providers = ["openai", "anthropic", "grok", "google"] as const;
    const result: Record<string, { set: boolean; source: "config" | "env" | "none" }> = {};
    for (const p of providers) {
      const fromConfig = config.apiKeys?.[p] || "";
      const envMap: Record<string, string> = {
        openai: process.env.OPENAI_API_KEY || "",
        anthropic: process.env.ANTHROPIC_API_KEY || "",
        grok: process.env.GROK_API_KEY || "",
        google: process.env.GOOGLE_API_KEY || "",
      };
      const fromEnv = envMap[p] || "";
      if (fromConfig) result[p] = { set: true, source: "config" };
      else if (fromEnv) result[p] = { set: true, source: "env" };
      else result[p] = { set: false, source: "none" };
    }
    return result;
  }

  /** Detect provider from env vars only (used during initial config creation). */
  private detectProviderFromEnv(): string {
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith("sk-ant")) return "claude";
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith("sk-")) return "openai";
    if (process.env.GROK_API_KEY) return "grok";
    if (process.env.GOOGLE_API_KEY) return "google";
    return "claude";
  }

  /** Detect best provider from all sources (config keys + env vars). */
  detectProvider(): string {
    const configPath = path.join(this.rootDir, "config.json");
    if (fs.existsSync(configPath)) {
      const config = readJson(configPath, {} as any);
      const keys = config.apiKeys || {};
      if (keys.anthropic) return "claude";
      if (keys.openai) return "openai";
      if (keys.grok) return "grok";
      if (keys.google) return "google";
    }
    return this.detectProviderFromEnv();
  }

  getConfig(): Config {
    const configPath = path.join(this.rootDir, "config.json");
    if (!fs.existsSync(configPath)) {
      const config = {
        dataDir: this.rootDir,
        aiProvider: this.detectProviderFromEnv(),
        apiKeys: { openai: "", anthropic: "", grok: "", google: "" },
        vectorSearch: "local" as const,
        browserBackend: "none" as const,
        mcpServers: {},
        theme: "system" as const,
        agent: {
          maxTurns: 10,
          maxTokens: 4096,
          temperature: 0.7,
          fetchTimeout: 15000,
          fetchMaxLength: 15000,
          systemPromptSuffix: "",
        },
      };
      writeJson(configPath, config);
      return config as Config;
    }
    return readJson(configPath, {} as Config);
  }

  saveConfig(config: Partial<Config>): Config {
    const existing = this.getConfig();
    const merged = { ...existing, ...config };
    writeJson(path.join(this.rootDir, "config.json"), merged);
    return merged;
  }

  // ============ MIGRATION ============
  /** Migrate from flat .cortex-data to vault structure */
  private migrate() {
    const vaults = this.getVaultsIndex();
    if (vaults.length > 0) return; // Already migrated

    // Check if old flat data exists
    const oldNotesIndex = path.join(this.rootDir, "notes", "index.json");
    const oldTasksFile = path.join(this.rootDir, "tasks", "tasks.json");
    const oldChatDir = path.join(this.rootDir, "chat", "sessions");
    const hasOldData = fs.existsSync(oldNotesIndex) || fs.existsSync(oldTasksFile) || fs.existsSync(oldChatDir);

    // Create default vault
    const now = new Date().toISOString();
    const defaultVault: Vault = {
      id: uuid(),
      name: "Personal",
      slug: "personal",
      icon: "\ud83c\udfe0",
      color: "#6366f1",
      settings: { folderPath: null, browserHeadless: false, aiModel: null },
      createdAt: now,
      updatedAt: now,
    };
    this.saveVaultsIndex([defaultVault]);

    const vaultDir = path.join(this.vaultsDir, defaultVault.slug);
    ensureDir(vaultDir);

    if (hasOldData) {
      // Move old data into the default vault folder
      const dirsToMove = ["notes", "tasks", "chat", "skills", "search"];
      for (const dir of dirsToMove) {
        const oldDir = path.join(this.rootDir, dir);
        const newDir = path.join(vaultDir, dir);
        if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
          // Copy recursively (we don't delete old files for safety)
          copyDirRecursive(oldDir, newDir);
        }
      }
    }

    // Initialize the vault storage (creates dirs/defaults if needed)
    this.getStorage(defaultVault.id);
  }
}

function copyDirRecursive(src: string, dest: string) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Global singleton
export const vaultManager = new VaultManager();

// Backward-compatible default storage (for agent.ts etc.)
// This will be replaced by vault-scoped access via routes
export const storage = vaultManager.getStorage(vaultManager.getDefaultVault().id);
