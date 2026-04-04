/**
 * Storage unit tests — FileStorage CRUD, frontmatter parsing, config, etc.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { FileStorage, VaultManager } from "../server/storage.js";

let tmpDir: string;
let storage: FileStorage;
let vaultMgr: VaultManager;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-test-"));
  storage = new FileStorage(tmpDir);
  vaultMgr = new VaultManager(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Notes CRUD ─────────────────────────────────────────────────────────────

describe("FileStorage: notes", () => {
  it("creates and retrieves a note", () => {
    const note = storage.createNote({ title: "Hello World", content: "# Hello\nTest content", folder: "/" });
    expect(note.id).toBeTruthy();
    expect(note.title).toBe("Hello World");

    const fetched = storage.getNote(note.id);
    expect(fetched).not.toBeUndefined();
    expect(fetched!.title).toBe("Hello World");
    expect(fetched!.content).toBe("# Hello\nTest content");
  });

  it("returns all notes", () => {
    storage.createNote({ title: "Note A", content: "A", folder: "/" });
    storage.createNote({ title: "Note B", content: "B", folder: "/work" });
    const notes = storage.getNotes();
    expect(notes.length).toBe(2);
    const titles = notes.map(n => n.title);
    expect(titles).toContain("Note A");
    expect(titles).toContain("Note B");
  });

  it("updates a note", () => {
    const note = storage.createNote({ title: "Original", content: "before", folder: "/" });
    const updated = storage.updateNote(note.id, { title: "Updated", content: "after" });
    expect(updated).not.toBeUndefined();
    expect(updated!.title).toBe("Updated");
    expect(updated!.content).toBe("after");

    const fetched = storage.getNote(note.id);
    expect(fetched!.title).toBe("Updated");
  });

  it("deletes a note", () => {
    const note = storage.createNote({ title: "To Delete", content: "", folder: "/" });
    const deleted = storage.deleteNote(note.id);
    expect(deleted).toBe(true);
    expect(storage.getNote(note.id)).toBeUndefined();
  });

  it("returns undefined for unknown note id", () => {
    expect(storage.getNote("nonexistent-id")).toBeUndefined();
  });

  it("handles note with tags and pinned", () => {
    const note = storage.createNote({ title: "Tagged", content: "body", folder: "/", tags: ["work", "research"], pinned: true });
    const fetched = storage.getNote(note.id);
    expect(fetched!.tags).toEqual(["work", "research"]);
    expect(fetched!.pinned).toBe(true);
  });
});

// ─── Tasks ───────────────────────────────────────────────────────────────────

describe("FileStorage: tasks", () => {
  it("creates and retrieves a task", () => {
    const task = storage.createTask({ title: "Fix bug", status: "todo", priority: "high" });
    expect(task.id).toBeTruthy();
    const tasks = storage.getTasks();
    expect(tasks.some(t => t.id === task.id)).toBe(true);
  });

  it("updates task status", () => {
    const task = storage.createTask({ title: "Do work", status: "todo", priority: "medium" });
    const updated = storage.updateTask(task.id, { status: "done" });
    expect(updated!.status).toBe("done");
  });

  it("deletes a task", () => {
    const task = storage.createTask({ title: "Temp", status: "todo", priority: "low" });
    storage.deleteTask(task.id);
    const tasks = storage.getTasks();
    expect(tasks.some(t => t.id === task.id)).toBe(false);
  });
});

// ─── Config (on VaultManager, not FileStorage) ────────────────────────────────

describe("VaultManager: config", () => {
  it("returns a default config when none exists", () => {
    const config = vaultMgr.getConfig();
    expect(config).toBeTruthy();
    expect(typeof config).toBe("object");
    expect(typeof config.mcpServers).toBe("object");
  });

  it("saves and reloads config", () => {
    const original = vaultMgr.getConfig();
    vaultMgr.saveConfig({ ...original, theme: "dark" });
    const reloaded = vaultMgr.getConfig();
    expect(reloaded.theme).toBe("dark");
  });

  it("includes fetch and memory in default mcpServers", () => {
    const config = vaultMgr.getConfig();
    expect("fetch" in config.mcpServers).toBe(true);
    expect("memory" in config.mcpServers).toBe(true);
  });
});

// ─── Note search ─────────────────────────────────────────────────────────────

describe("FileStorage: search", () => {
  it("searches notes by content", () => {
    storage.createNote({ title: "Alpha", content: "quantum mechanics", folder: "/" });
    storage.createNote({ title: "Beta", content: "classical music", folder: "/" });
    const results = storage.search("quantum");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("Alpha");
  });

  it("returns empty for no matches", () => {
    storage.createNote({ title: "Hello", content: "world", folder: "/" });
    const results = storage.search("zzznomatch");
    expect(results.length).toBe(0);
  });
});

// ─── Vault CRUD ───────────────────────────────────────────────────────────────

describe("VaultManager: vault CRUD", () => {
  it("creates a vault", () => {
    const vault = vaultMgr.createVault({ name: "Test Vault", icon: "📁", color: "#123456" });
    expect(vault.id).toBeTruthy();
    expect(vault.name).toBe("Test Vault");
    expect(vault.slug).toBe("test-vault");
  });

  it("retrieves vault by id", () => {
    const vault = vaultMgr.createVault({ name: "Find Me" });
    const found = vaultMgr.getVault(vault.id);
    expect(found).not.toBeUndefined();
    expect(found!.name).toBe("Find Me");
  });

  it("returns undefined for unknown vault id", () => {
    expect(vaultMgr.getVault("does-not-exist")).toBeUndefined();
  });

  it("lists all vaults", () => {
    vaultMgr.createVault({ name: "Vault A" });
    vaultMgr.createVault({ name: "Vault B" });
    // Plus the default vault created by migration
    const vaults = vaultMgr.getVaults();
    const names = vaults.map(v => v.name);
    expect(names).toContain("Vault A");
    expect(names).toContain("Vault B");
  });
});

// ─── External vault / frontmatter (rootFolder mode) ──────────────────────────

describe("FileStorage: external vault (rootFolder)", () => {
  let rootFolder: string;
  let externalStorage: FileStorage;

  beforeEach(() => {
    rootFolder = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-vault-"));
    externalStorage = new FileStorage(path.join(rootFolder, ".cortex-data"), rootFolder);
  });

  afterEach(() => {
    fs.rmSync(rootFolder, { recursive: true, force: true });
  });

  it("reads .md files from rootFolder as notes", () => {
    fs.writeFileSync(path.join(rootFolder, "hello.md"), "# Hello\nThis is a note.", "utf-8");
    const notes = externalStorage.getNotes();
    expect(notes.length).toBe(1);
    expect(notes[0].title).toBe("Hello");
    expect(notes[0].content).toContain("This is a note.");
  });

  it("parses frontmatter tags and title", () => {
    const content = `---
title: My Note
tags: [research, ai]
---

# My Note

Body content.`;
    fs.writeFileSync(path.join(rootFolder, "my-note.md"), content, "utf-8");
    const notes = externalStorage.getNotes();
    const note = notes.find(n => n.title === "My Note");
    expect(note).toBeTruthy();
    expect(note!.tags).toEqual(["research", "ai"]);
  });

  it("uses filename as title when no heading", () => {
    fs.writeFileSync(path.join(rootFolder, "untitled-file.md"), "Just some content.", "utf-8");
    const notes = externalStorage.getNotes();
    const note = notes.find(n => n.title === "untitled-file");
    expect(note).toBeTruthy();
  });

  it("derives folder from subdirectory", () => {
    fs.mkdirSync(path.join(rootFolder, "work"), { recursive: true });
    fs.writeFileSync(path.join(rootFolder, "work", "project.md"), "# Project\nDetails.", "utf-8");
    const notes = externalStorage.getNotes();
    const note = notes.find(n => n.title === "Project");
    expect(note).toBeTruthy();
    expect(note!.folder).toBe("/work");
  });

  it("getNoteByFilePath returns correct note", () => {
    fs.writeFileSync(path.join(rootFolder, "findme.md"), "# Find Me\nContent.", "utf-8");
    externalStorage.getNotes(); // populate cache
    const note = externalStorage.getNoteByFilePath("findme.md");
    expect(note).not.toBeUndefined();
    expect(note!.title).toBe("Find Me");
  });
});
