import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import type { Note, InsertNote, NoteGroup, InsertNoteGroup, Task, InsertTask, ChatSession, ChatEvent, Skill, Config, SearchResult, Vault, InsertVault, VaultSettings } from "@shared/schema";
import { defaultSkills } from "./default-skills";

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

// ── Markdown / frontmatter helpers (used by external vault mode) ──────────────

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Handles: string values, booleans, inline arrays [a, b, c], and multi-line lists.
 * Compatible with Obsidian frontmatter conventions.
 */
function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/);
  if (!fmMatch) return { meta: {}, body: content };

  const meta: Record<string, any> = {};
  const lines = fmMatch[1].split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Inline array:  key: [val1, val2]
    const inlineArr = line.match(/^([\w-]+):\s*\[(.*)]\s*$/);
    if (inlineArr) {
      meta[inlineArr[1]] = inlineArr[2]
        .split(",")
        .map(s => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      i++; continue;
    }

    // Multi-line list:  key:\n  - val1\n  - val2
    const multiArr = line.match(/^([\w-]+):\s*$/);
    if (multiArr && i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1])) {
      const vals: string[] = [];
      i++;
      while (i < lines.length && /^\s*-\s/.test(lines[i])) {
        vals.push(lines[i].replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""));
        i++;
      }
      meta[multiArr[1]] = vals;
      continue;
    }

    // Simple key: value
    const kv = line.match(/^([\w-]+):\s*(.+)$/);
    if (kv) {
      const val = kv[2].trim().replace(/^["']|["']$/g, "");
      meta[kv[1]] = val === "true" ? true : val === "false" ? false : val;
    }
    i++;
  }
  return { meta, body: fmMatch[2] };
}

/** Serialize metadata to YAML frontmatter block. */
function serializeFrontmatter(meta: Record<string, any>): string {
  const lines = ["---"];
  for (const [key, val] of Object.entries(meta)) {
    if (val === null || val === undefined) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}: [${val.map(v => `"${v}"`).join(", ")}]`);
    } else if (typeof val === "boolean") {
      lines.push(`${key}: ${val}`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/** Recursively walk a directory, calling callback for each file. Skips hidden directories. */
function walkDir(dir: string, callback: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // skip .cortex-data, .git, .obsidian etc.
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, callback);
    else callback(full);
  }
}

/** Deterministic ID for a .md file that has no cortex_id frontmatter. Based on relative path. */
function pathToNoteId(relativePath: string): string {
  const norm = relativePath.replace(/\\/g, "/");
  let h = 0;
  for (let i = 0; i < norm.length; i++) { h = Math.imul(31, h) + norm.charCodeAt(i) | 0; }
  return "ext-" + Math.abs(h).toString(36);
}

/** Sanitize a note title to a safe filename (no slashes, no reserved chars). */
function sanitizeFilename(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "untitled";
}

/**
 * FileStorage: operates within a single vault directory.
 * All notes, tasks, chat, skills are scoped to this directory.
 */
export class FileStorage {
  private dataDir: string;
  /** Root folder for external vaults (e.g. an Obsidian vault). When set, notes are .md files here. */
  private rootFolder: string | null;
  /** Cache: note ID → absolute .md file path. Populated during scanMdFiles(). */
  private mdPathCache = new Map<string, string>();

  constructor(dataDir: string, rootFolder?: string | null) {
    this.dataDir = dataDir;
    this.rootFolder = rootFolder || null;
    this.initVaultDirs();
  }

  private initVaultDirs() {
    ensureDir(this.dataDir);
    ensureDir(path.join(this.dataDir, "notes"));

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

  /** True when this vault points to an external folder (notes live as .md files there). */
  isExternalVault(): boolean { return !!this.rootFolder; }

  // ── External vault: .md file helpers ────────────────────────────────────────

  /**
   * Scan all .md files in rootFolder and return them as Note objects.
   * Populates mdPathCache for fast subsequent lookups.
   */
  private scanMdFiles(): Note[] {
    if (!this.rootFolder) return [];
    this.mdPathCache.clear();
    const notes: Note[] = [];
    walkDir(this.rootFolder, (filePath) => {
      if (!filePath.endsWith(".md")) return;
      const rel = path.relative(this.rootFolder!, filePath);
      try {
        const note = this.parseMdNote(filePath, rel);
        notes.push(note);
        this.mdPathCache.set(note.id, filePath);
      } catch { /* skip unreadable files */ }
    });
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Parse a single .md file into a Note. Title is derived from first # heading or filename. */
  private parseMdNote(filePath: string, relativePath: string): Note {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);

    // Stable ID: cortex_id from frontmatter, or deterministic hash of path
    const id = (meta.cortex_id as string) || pathToNoteId(relativePath);

    // Title: from first heading, or filename
    const headingMatch = body.match(/^#\s+(.+)$/m);
    const title = headingMatch
      ? headingMatch[1].trim()
      : path.basename(relativePath, ".md");

    // Folder: derived from directory relative to rootFolder
    const dir = path.dirname(relativePath);
    const folder = dir === "." ? "/" : "/" + dir.replace(/\\/g, "/");

    // Tags: support cortex tags AND Obsidian tags
    const tags: string[] = Array.isArray(meta.tags) ? meta.tags
      : Array.isArray(meta.tag) ? meta.tag : [];

    const stat = fs.statSync(filePath);
    return {
      id,
      title,
      content: body,
      folder,
      groupId: (meta.groupId as string) || "default",
      tags,
      attachments: Array.isArray(meta.attachments) ? meta.attachments : [],
      pinned: !!(meta.pinned),
      createdAt: (meta.created as string) || stat.birthtime.toISOString(),
      updatedAt: (meta.updated as string) || stat.mtime.toISOString(),
    };
  }

  /**
   * Compute the intended .md file path for a note.
   * Used only when CREATING a new note (preserves original path on updates).
   */
  private noteMdPath(note: Pick<Note, "title" | "folder">): string {
    const folderPart = note.folder === "/" ? "" : note.folder.replace(/^\//, "");
    const dir = folderPart ? path.join(this.rootFolder!, folderPart) : this.rootFolder!;
    return path.join(dir, `${sanitizeFilename(note.title)}.md`);
  }

  /**
   * Write a Note to its .md file (creates new file).
   * For updates to existing files, use updateMdNoteFile() which preserves the original path.
   */
  private writeMdNote(note: Note): void {
    if (!this.rootFolder) return;
    const filePath = this.noteMdPath(note);
    ensureDir(path.dirname(filePath));
    const meta: Record<string, any> = { cortex_id: note.id, created: note.createdAt, updated: note.updatedAt };
    if (note.tags.length > 0) meta.tags = note.tags;
    if (note.pinned) meta.pinned = note.pinned;
    if (note.attachments.length > 0) meta.attachments = note.attachments;
    fs.writeFileSync(filePath, serializeFrontmatter(meta) + note.content, "utf-8");
    this.mdPathCache.set(note.id, filePath);
  }

  /**
   * Find the .md file for a note ID. Checks cache first, then scans.
   * Returns null if not found.
   */
  private findNoteFile(id: string): string | null {
    if (!this.rootFolder) return null;
    const cached = this.mdPathCache.get(id);
    if (cached && fs.existsSync(cached)) return cached;

    // Cache miss — scan to find the file
    let found: string | null = null;
    walkDir(this.rootFolder, (filePath) => {
      if (found || !filePath.endsWith(".md")) return;
      const rel = path.relative(this.rootFolder!, filePath);
      // Quick check: path-derived ID matches (no file read needed)
      if (pathToNoteId(rel) === id) { found = filePath; return; }
      // Slower: check cortex_id in frontmatter
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const { meta } = parseFrontmatter(raw);
        if (meta.cortex_id === id) found = filePath;
      } catch { /* skip */ }
    });
    if (found) this.mdPathCache.set(id, found);
    return found;
  }

  /** Update an existing .md file with new note data, preserving the original filename. */
  private updateMdNoteFile(id: string, updates: Partial<Note>): Note | undefined {
    const filePath = this.findNoteFile(id);
    if (!filePath) return undefined;

    const rel = path.relative(this.rootFolder!, filePath);
    const current = this.parseMdNote(filePath, rel);
    const updated: Note = { ...current, ...updates, updatedAt: new Date().toISOString() };

    // Re-read existing frontmatter to preserve Obsidian/third-party fields
    const raw = fs.readFileSync(filePath, "utf-8");
    const { meta: existingMeta } = parseFrontmatter(raw);
    const meta: Record<string, any> = {
      ...existingMeta,
      cortex_id: updated.id,
      updated: updated.updatedAt,
    };
    if (updated.tags.length > 0) meta.tags = updated.tags; else delete meta.tags;
    if (updated.pinned) meta.pinned = true; else delete meta.pinned;
    if (updated.attachments.length > 0) meta.attachments = updated.attachments; else delete meta.attachments;

    fs.writeFileSync(filePath, serializeFrontmatter(meta) + updated.content, "utf-8");
    return updated;
  }
  private noteGroupsPath() { return path.join(this.dataDir, "notes", "groups.json"); }

  // ============ NOTE GROUPS ============

  getNoteGroups(vaultName?: string): NoteGroup[] {
    const groups: NoteGroup[] = readJson(this.noteGroupsPath(), []);
    if (groups.length === 0) {
      // Auto-create default group named after the vault
      const now = new Date().toISOString();
      const defaultGroup: NoteGroup = {
        id: "default",
        name: vaultName || "Notes",
        icon: "📁",
        color: "#6366f1",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      };
      writeJson(this.noteGroupsPath(), [defaultGroup]);
      return [defaultGroup];
    }
    return groups;
  }

  createNoteGroup(input: InsertNoteGroup): NoteGroup {
    const now = new Date().toISOString();
    const group: NoteGroup = {
      id: uuid(),
      name: input.name,
      icon: input.icon || "📁",
      color: input.color || "#6366f1",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
    const groups = this.getNoteGroups();
    groups.push(group);
    writeJson(this.noteGroupsPath(), groups);
    return group;
  }

  updateNoteGroup(id: string, updates: Partial<NoteGroup>): NoteGroup | undefined {
    const groups = this.getNoteGroups();
    const idx = groups.findIndex(g => g.id === id);
    if (idx === -1) return undefined;
    groups[idx] = { ...groups[idx], ...updates, updatedAt: new Date().toISOString() };
    writeJson(this.noteGroupsPath(), groups);
    return groups[idx];
  }

  deleteNoteGroup(id: string): boolean {
    const groups = this.getNoteGroups();
    const target = groups.find(g => g.id === id);
    if (!target || target.isDefault) return false;
    // Reassign all notes in this group to the default group
    if (this.rootFolder) {
      // External mode: update each affected .md file individually
      for (const note of this.getNotes()) {
        if (note.groupId === id) this.updateNote(note.id, { groupId: "default" });
      }
    } else {
      const notes = this.getNotesIndex();
      let changed = false;
      for (const note of notes) {
        if (note.groupId === id) { note.groupId = "default"; changed = true; }
      }
      if (changed) this.saveNotesIndex(notes);
    }
    writeJson(this.noteGroupsPath(), groups.filter(g => g.id !== id));
    return true;
  }

  // ============ NOTES ============
  private notesIndexPath() { return path.join(this.dataDir, "notes", "index.json"); }

  private getNotesIndex(): Note[] {
    if (this.rootFolder) return this.scanMdFiles();
    return readJson(this.notesIndexPath(), []);
  }

  private saveNotesIndex(notes: Note[]) {
    if (this.rootFolder) return; // External mode: writes happen per-note, not as a bulk index
    writeJson(this.notesIndexPath(), notes);
  }

  getNotes(): Note[] {
    return this.getNotesIndex();
  }

  getNote(id: string): Note | undefined {
    if (this.rootFolder) {
      const filePath = this.findNoteFile(id);
      if (!filePath) return undefined;
      const rel = path.relative(this.rootFolder, filePath);
      try { return this.parseMdNote(filePath, rel); } catch { return undefined; }
    }
    return this.getNotesIndex().find(n => n.id === id);
  }

  createNote(input: InsertNote): Note {
    const now = new Date().toISOString();
    const note: Note = {
      id: uuid(),
      title: input.title,
      content: input.content,
      folder: input.folder || "/",
      groupId: input.groupId || "default",
      tags: input.tags || [],
      attachments: input.attachments || [],
      pinned: input.pinned || false,
      createdAt: now,
      updatedAt: now,
    };

    if (this.rootFolder) {
      this.writeMdNote(note);
      return note;
    }

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
    if (this.rootFolder) return this.updateMdNoteFile(id, updates);
    const notes = this.getNotesIndex();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return undefined;
    notes[idx] = { ...notes[idx], ...updates, updatedAt: new Date().toISOString() };
    this.saveNotesIndex(notes);
    return notes[idx];
  }

  deleteNote(id: string): boolean {
    if (this.rootFolder) {
      const filePath = this.findNoteFile(id);
      if (!filePath || !fs.existsSync(filePath)) return false;
      fs.unlinkSync(filePath);
      this.mdPathCache.delete(id);
      return true;
    }
    const notes = this.getNotesIndex();
    const filtered = notes.filter(n => n.id !== id);
    if (filtered.length === notes.length) return false;
    this.saveNotesIndex(filtered);
    return true;
  }

  bulkDeleteNotes(ids: string[]): number {
    if (this.rootFolder) {
      let deleted = 0;
      for (const id of ids) { if (this.deleteNote(id)) deleted++; }
      return deleted;
    }
    const idSet = new Set(ids);
    const notes = this.getNotesIndex();
    const filtered = notes.filter(n => !idSet.has(n.id));
    const deleted = notes.length - filtered.length;
    if (deleted > 0) this.saveNotesIndex(filtered);
    return deleted;
  }

  getNoteFolders(): string[] {
    const notes = this.getNotes();
    const folders = new Set(notes.map(n => n.folder));
    folders.add("/");
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

  /**
   * Copy an image from a chat asset (or other note asset) URL into this note's
   * dedicated assets folder.  Returns the new note-asset URL, or null if the
   * source buffer could not be found.
   */
  migrateImageToNote(noteId: string, sourceUrl: string): string | null {
    let buffer: Buffer | null = null;
    let originalFilename = "image.png";

    // /api/chat/assets/<filename>
    const chatMatch = sourceUrl.match(/\/api\/chat\/assets\/(.+)$/);
    if (chatMatch) {
      originalFilename = chatMatch[1];
      buffer = this.getChatAsset(originalFilename);
      if (!buffer) {
        console.log(`[migrate] Chat asset not found: ${originalFilename}`);
      }
    }

    // /api/notes/<noteId>/assets/<filename>
    if (!buffer) {
      const noteMatch = sourceUrl.match(/\/api\/notes\/([^/]+)\/assets\/(.+)$/);
      if (noteMatch) {
        originalFilename = noteMatch[2];
        buffer = this.getNoteAsset(noteMatch[1], originalFilename);
      }
    }

    if (!buffer) {

      return null;
    }

    // Save to this note's assets folder
    const newFilename = `${Date.now()}-${originalFilename}`;
    const newUrl = this.saveNoteAsset(noteId, newFilename, buffer);
    return newUrl;
  }

  /**
   * Scan markdown content for image references pointing to chat assets
   * (or other non-local paths) and migrate them into the note's own
   * assets folder.  Returns the rewritten content.
   */
  migrateContentImages(noteId: string, content: string): string {
    // Match markdown images: ![alt](/api/chat/assets/...) or ![alt](/api/notes/OTHER_ID/assets/...)
    let matchCount = 0;
    const result = content.replace(
      /(!\[[^\]]*\])\((\/api\/(?:chat\/assets|notes\/[^/]+\/assets)\/[^)]+)\)/g,
      (_match, altPart, url) => {
        matchCount++;
        // Don't migrate if already pointing to this note's assets
        if (url.startsWith(`/api/notes/${noteId}/assets/`)) return _match;
        const newUrl = this.migrateImageToNote(noteId, url);
        return newUrl ? `${altPart}(${newUrl})` : _match;
      }
    );
    if (matchCount === 0 && content.includes("/api/")) {
      // Possible mis-formatted image URL — no action needed, just pass through
    }
    return result;
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

  /** Extract readable text from a file. Returns null for images/binary. */
  getFileText(id: string): string | null {
    const file = this.getFile(id);
    if (!file) return null;
    const { buffer, name, mimeType } = file;
    // Images — handled separately as visual content
    if (mimeType.startsWith("image/")) return null;
    // Text, code, JSON, CSV, XML, YAML etc
    if (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml") ||
        mimeType.includes("yaml") || mimeType.includes("csv") || mimeType.includes("javascript") ||
        mimeType.includes("typescript") || mimeType.includes("markdown")) {
      return buffer.toString("utf-8");
    }
    // PDF placeholder
    if (mimeType.includes("pdf")) return `[PDF file: ${name}]`;
    // Office docs placeholder
    if (mimeType.includes("word") || mimeType.includes("document") || mimeType.includes("spreadsheet") ||
        mimeType.includes("presentation") || mimeType.includes("excel") || mimeType.includes("powerpoint")) {
      return `[Office document: ${name}]`;
    }
    return `[Binary file: ${name} (${mimeType})]`;
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
  private skillsDir() { return path.join(this.dataDir, "skills"); }

  getSkills(): Skill[] {
    return readJson(this.skillsPath(), []);
  }

  saveSkill(skill: Skill): void {
    const skills = this.getSkills();
    const idx = skills.findIndex(s => s.name === skill.name);
    if (idx !== -1) skills[idx] = skill;
    else skills.push(skill);
    writeJson(this.skillsPath(), skills);
    // Write-through: also save as individual file in skills directory
    const filePath = skill.filePath || path.join(this.skillsDir(), `${skill.name}.json`);
    skill.filePath = filePath;
    writeJson(filePath, skill);
  }

  deleteSkill(name: string): boolean {
    const skills = this.getSkills();
    const skill = skills.find(s => s.name === name);
    const filtered = skills.filter(s => s.name !== name);
    if (filtered.length === skills.length) return false;
    writeJson(this.skillsPath(), filtered);
    // Also remove the individual file if it exists
    if (skill?.filePath && fs.existsSync(skill.filePath)) {
      try { fs.unlinkSync(skill.filePath); } catch {}
    } else {
      const defaultPath = path.join(this.skillsDir(), `${name}.json`);
      if (fs.existsSync(defaultPath)) try { fs.unlinkSync(defaultPath); } catch {}
    }
    return true;
  }

  /** Load individual .json skill files from the skills directory. */
  private loadSkillsFromDirectory(): Skill[] {
    const dir = this.skillsDir();
    if (!fs.existsSync(dir)) return [];
    const dirSkills: Skill[] = [];
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "skills.json");
      for (const file of files) {
        try {
          const filePath = path.join(dir, file);
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (data && data.name) {
            data.filePath = filePath;
            dirSkills.push(data as Skill);
          }
        } catch { /* skip malformed files */ }
      }
    } catch { /* directory read error */ }
    return dirSkills;
  }

  private initBuiltinSkills() {
    const existingSkills = this.getSkills();
    const builtins: Skill[] = defaultSkills;

    // Write each builtin as an individual .json file (so users can discover & edit)
    const dir = this.skillsDir();
    for (const b of builtins) {
      const filePath = path.join(dir, `${b.name}.json`);
      b.filePath = filePath;
      // Only write the file if it doesn't exist or the version changed
      if (!fs.existsSync(filePath)) {
        writeJson(filePath, b);
      } else {
        try {
          const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (existing.builtin && existing.version !== b.version) {
            writeJson(filePath, b);
          }
        } catch { writeJson(filePath, b); }
      }
    }

    // Load all skills from directory (includes builtins we just wrote + user custom ones)
    const dirSkills = this.loadSkillsFromDirectory();

    // Merge: directory skills take precedence. Preserve user's enabled/disabled state.
    const merged = new Map<string, Skill>();
    for (const b of builtins) {
      merged.set(b.name, b);
    }
    for (const ds of dirSkills) {
      merged.set(ds.name, ds);
    }
    // Preserve user's enabled/disabled state from existing skills.json
    for (const existing of existingSkills) {
      const m = merged.get(existing.name);
      if (m && m.builtin) {
        // Keep user's enabled preference
        m.enabled = existing.enabled;
      } else if (!m) {
        // Custom skill that was in skills.json but not in directory — keep it
        merged.set(existing.name, existing);
      }
    }

    writeJson(this.skillsPath(), Array.from(merged.values()));
  }

  // ============ STATS ============
  private statsPath() { return path.join(this.dataDir, "stats.json"); }

  getStats(): { totalInputTokens: number; totalOutputTokens: number; totalRequests: number } {
    return readJson(this.statsPath(), { totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0 });
  }

  addTokenUsage(inputTokens: number, outputTokens: number): void {
    const stats = this.getStats();
    stats.totalInputTokens += inputTokens;
    stats.totalOutputTokens += outputTokens;
    stats.totalRequests += 1;
    writeJson(this.statsPath(), stats);
  }

  resetStats(): void {
    writeJson(this.statsPath(), { totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0 });
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
   * Resolve the filesystem directory for a vault's data.
   * - If vault has a folderPath, data lives at <folderPath>/.cortex-data/
   *   so Cortex metadata stays self-contained within the user's chosen folder.
   * - Otherwise fall back to .cortex-data/vaults/<slug>/
   */
  private resolveVaultDir(vault: Vault): string {
    if (vault.settings?.folderPath) {
      return path.join(vault.settings.folderPath, ".cortex-data");
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
    const storage = new FileStorage(vaultDir, vault.settings?.folderPath);
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
        browserBackend: "playwright-mcp" as const,
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
