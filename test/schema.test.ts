/**
 * Schema validation tests — verify Zod schemas parse valid/invalid inputs correctly.
 */
import { describe, it, expect } from "vitest";
import {
  insertNoteSchema,
  insertTaskSchema,
  chatEventSchema,
  chatSessionSchema,
} from "../shared/schema.js";

describe("insertNoteSchema", () => {
  it("accepts a valid note", () => {
    const result = insertNoteSchema.safeParse({ title: "My Note", content: "Hello", folder: "/" });
    expect(result.success).toBe(true);
  });

  it("accepts note with optional fields", () => {
    const result = insertNoteSchema.safeParse({
      title: "Tagged Note",
      content: "Body",
      folder: "/work",
      tags: ["ai", "research"],
      pinned: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts note without folder (folder is optional)", () => {
    const result = insertNoteSchema.safeParse({ title: "Minimal", content: "" });
    // folder is optional in insertNoteSchema; content is required
    expect(result.success).toBe(true);
  });
});

describe("insertTaskSchema", () => {
  it("accepts a valid task", () => {
    const result = insertTaskSchema.safeParse({ title: "Fix bug", status: "todo", priority: "high" });
    expect(result.success).toBe(true);
  });

  it("accepts task with subtasks", () => {
    const result = insertTaskSchema.safeParse({
      title: "Big project",
      status: "in_progress",
      priority: "medium",
      subtasks: [
        { title: "Sub 1", completed: false },
        { title: "Sub 2", completed: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status value", () => {
    const result = insertTaskSchema.safeParse({ title: "Bad", status: "unknown_status", priority: "high" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority value", () => {
    const result = insertTaskSchema.safeParse({ title: "Bad", status: "todo", priority: "extreme" });
    expect(result.success).toBe(false);
  });
});

describe("chatSessionSchema", () => {
  it("accepts a session with defaults", () => {
    const result = chatSessionSchema.safeParse({
      id: "sess-1",
      title: "Session 1",
      events: [],
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = chatSessionSchema.safeParse({
      id: "sess-2",
      title: "Test",
      events: [],
      status: "invalid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe("chatEventSchema type enum", () => {
  // These are the actual valid types from shared/schema.ts
  const validTypes = ["thought", "action", "action_result", "message", "error", "plan", "tool_call", "tool_result", "question", "delta"];

  validTypes.forEach((type) => {
    it(`accepts event type: ${type}`, () => {
      const result = chatEventSchema.shape.type.safeParse(type);
      expect(result.success).toBe(true);
    });
  });

  it("rejects unknown event type", () => {
    const result = chatEventSchema.shape.type.safeParse("unknown_type");
    expect(result.success).toBe(false);
  });
});

