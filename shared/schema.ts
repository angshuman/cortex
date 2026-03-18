import { z } from "zod";

// ============ VAULTS ============
export const vaultSettingsSchema = z.object({
  /** Absolute folder path on disk. If set, vault data lives here instead of .cortex-data/vaults/<slug>/ */
  folderPath: z.string().nullable().default(null),
  /** Whether the browser runs headless (no visible window). Default false = show browser UI. */
  browserHeadless: z.boolean().default(false),
  /** AI model override for this vault (uses global default if empty) */
  aiModel: z.string().nullable().default(null),
});
export type VaultSettings = z.infer<typeof vaultSettingsSchema>;

export const vaultSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  icon: z.string().default("📁"),
  color: z.string().default("#6366f1"),
  settings: vaultSettingsSchema.default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Vault = z.infer<typeof vaultSchema>;
export const insertVaultSchema = z.object({
  name: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  settings: vaultSettingsSchema.partial().optional(),
});
export type InsertVault = z.infer<typeof insertVaultSchema>;

// ============ NOTES ============
export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  folder: z.string().default("/"),
  tags: z.array(z.string()).default([]),
  attachments: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  pinned: z.boolean().default(false),
});
export type Note = z.infer<typeof noteSchema>;
export const insertNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
  folder: z.string().optional(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});
export type InsertNote = z.infer<typeof insertNoteSchema>;

// ============ TASKS ============
export const taskStatusEnum = z.enum(["todo", "in_progress", "done", "archived"]);
export const taskPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  status: taskStatusEnum.default("todo"),
  priority: taskPriorityEnum.default("medium"),
  parentId: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  dueDate: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  order: z.number().default(0),
});
export type Task = z.infer<typeof taskSchema>;
export const insertTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  parentId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  dueDate: z.string().nullable().optional(),
  order: z.number().optional(),
});
export type InsertTask = z.infer<typeof insertTaskSchema>;

// ============ CHAT ============
export const chatEventSchema = z.object({
  id: z.string(),
  type: z.enum(["thought", "action", "action_result", "message", "error", "plan", "tool_call", "tool_result"]),
  content: z.string(),
  metadata: z.record(z.any()).optional(),
  timestamp: z.string(),
});
export type ChatEvent = z.infer<typeof chatEventSchema>;

export const chatSessionSchema = z.object({
  id: z.string(),
  title: z.string().default("New Chat"),
  events: z.array(chatEventSchema).default([]),
  status: z.enum(["active", "completed", "error"]).default("active"),
  createdAt: z.string(),
  updatedAt: z.string(),
  model: z.string().optional(),
  tokenUsage: z.object({ input: z.number(), output: z.number() }).optional(),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

// ============ SKILLS ============
export const skillToolParamSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
});

export const skillToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.array(skillToolParamSchema).default([]),
});

export const skillSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().default("1.0.0"),
  instructions: z.string().default(""),
  tools: z.array(skillToolSchema).default([]),
  enabled: z.boolean().default(true),
  builtin: z.boolean().default(false),
});
export type Skill = z.infer<typeof skillSchema>;

// ============ CONFIG ============
export const configSchema = z.object({
  dataDir: z.string().default("~/.cortex"),
  aiProvider: z.enum(["claude", "openai", "grok"]).default("claude"),
  aiModel: z.string().optional(),
  vectorSearch: z.enum(["local", "openai"]).default("local"),
  browserBackend: z.enum(["playwright-mcp", "none"]).default("none"),
  mcpServers: z.record(z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
  })).default({}),
  theme: z.enum(["light", "dark", "system"]).default("system"),
});
export type Config = z.infer<typeof configSchema>;

// ============ SEARCH ============
export const searchResultSchema = z.object({
  id: z.string(),
  type: z.enum(["note", "task", "chat"]),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
  path: z.string().optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
