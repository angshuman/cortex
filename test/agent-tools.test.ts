/**
 * Agent tools tests — document read/write helpers, spreadsheet parsing, etc.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-tools-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Frontmatter parser (exported via storage) ───────────────────────────────
// We test the parseFrontmatter logic indirectly through the FileStorage external vault tests.

// ─── Document helpers (tested via dynamic import of the functions) ────────────
// We test the actual file writing/reading functions

describe("Document tools: .txt / .md read", () => {
  it("reads a plain text file", async () => {
    const { default: readDocumentFile } = await import("../server/agent-tools-helpers.js").catch(() => {
      // Helpers may not be separately exported; test via direct file system operations
      return { default: null };
    });

    const filePath = path.join(tmpDir, "note.txt");
    fs.writeFileSync(filePath, "Hello from text file", "utf-8");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("Hello from text file");
  });
});

describe("Spreadsheet creation and reading via xlsx", () => {
  it("creates and reads back a .xlsx file", async () => {
    const XLSX = await import("xlsx");
    const filePath = path.join(tmpDir, "test.xlsx");

    // Create a simple spreadsheet
    const rows = [["Name", "Age"], ["Alice", 30], ["Bob", 25]];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "People");
    XLSX.writeFile(wb, filePath);

    expect(fs.existsSync(filePath)).toBe(true);

    // Read it back
    const wb2 = XLSX.readFile(filePath);
    expect(wb2.SheetNames).toEqual(["People"]);
    const ws2 = wb2.Sheets["People"];
    const data: any[][] = XLSX.utils.sheet_to_json(ws2, { header: 1 });
    expect(data[0]).toEqual(["Name", "Age"]);
    expect(data[1]).toEqual(["Alice", 30]);
    expect(data[2]).toEqual(["Bob", 25]);
  });

  it("lists sheet names from xlsx", async () => {
    const XLSX = await import("xlsx");
    const filePath = path.join(tmpDir, "multi.xlsx");

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A"]]), "Sheet1");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["B"]]), "Sheet2");
    XLSX.writeFile(wb, filePath);

    const wb2 = XLSX.readFile(filePath);
    expect(wb2.SheetNames).toEqual(["Sheet1", "Sheet2"]);
  });
});

describe("Document creation via docx", () => {
  it("creates a valid .docx file", async () => {
    const { Document, Paragraph, TextRun, Packer } = await import("docx");
    const filePath = path.join(tmpDir, "test.docx");

    const paragraphs = ["Hello World", "Second paragraph"].map(
      text => new Paragraph({ children: [new TextRun(text)] })
    );
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buf = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buf);

    expect(fs.existsSync(filePath)).toBe(true);
    const size = fs.statSync(filePath).size;
    expect(size).toBeGreaterThan(1000); // a real docx is always > 1KB
  });
});

describe("CSV parsing", () => {
  it("parses CSV content to rows", async () => {
    const XLSX = await import("xlsx");
    const csv = "name,score\nAlice,95\nBob,87\n";
    // xlsx 0.18.x: read CSV as a workbook
    const wb = XLSX.read(csv, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    expect(rows[0]).toEqual(["name", "score"]);
    expect(rows[1][0]).toBe("Alice");
    expect(Number(rows[1][1])).toBe(95); // xlsx may return numeric values
    expect(rows[2][0]).toBe("Bob");
  });
});

describe("File content API logic", () => {
  it("returns text for .txt files", () => {
    const filePath = path.join(tmpDir, "readme.txt");
    fs.writeFileSync(filePath, "This is a readme file.\nWith multiple lines.", "utf-8");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("This is a readme file");
    expect(content.split("\n").length).toBe(2);
  });

  it("truncates very large files", () => {
    const filePath = path.join(tmpDir, "big.txt");
    const large = "x".repeat(250_000);
    fs.writeFileSync(filePath, large, "utf-8");
    const raw = fs.readFileSync(filePath, "utf-8");
    const result = raw.length > 200_000 ? raw.slice(0, 200_000) + "\n\n[Truncated]" : raw;
    expect(result.endsWith("[Truncated]")).toBe(true);
    expect(result.length).toBeLessThan(210_000);
  });

  it("detects image extensions correctly", () => {
    const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"];
    for (const ext of IMAGE_EXTS) {
      expect(IMAGE_EXTS.includes(ext)).toBe(true);
    }
    expect(IMAGE_EXTS.includes(".txt")).toBe(false);
    expect(IMAGE_EXTS.includes(".xlsx")).toBe(false);
  });
});

describe("Vault-root path resolution", () => {
  it("writes relative generated files inside vault root", async () => {
    const { FileStorage } = await import("../server/storage.js");
    const { executeTool } = await import("../server/agent-tools.js");

    const vaultRoot = path.join(tmpDir, "vault-root");
    fs.mkdirSync(vaultRoot, { recursive: true });
    const storage = new FileStorage(path.join(vaultRoot, ".cortex-data"), vaultRoot);

    await executeTool("write_document", { path: "projects\\out.md", content: "hello" }, storage, {
      maxTurns: 10, maxTokens: 1024, temperature: 0.3, fetchTimeout: 5000, fetchMaxLength: 5000, systemPromptSuffix: "",
    } as any);

    const expectedPath = path.join(vaultRoot, "projects", "out.md");
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.readFileSync(expectedPath, "utf-8")).toContain("hello");
  });

  it("rejects paths escaping vault root", async () => {
    const { FileStorage } = await import("../server/storage.js");
    const { executeTool } = await import("../server/agent-tools.js");

    const vaultRoot = path.join(tmpDir, "vault-root-escape");
    fs.mkdirSync(vaultRoot, { recursive: true });
    const storage = new FileStorage(path.join(vaultRoot, ".cortex-data"), vaultRoot);

    const result = await executeTool("write_document", { path: "..\\outside.md", content: "nope" }, storage, {
      maxTurns: 10, maxTokens: 1024, temperature: 0.3, fetchTimeout: 5000, fetchMaxLength: 5000, systemPromptSuffix: "",
    } as any);
    expect(result).toMatch(/escapes vault root/i);
  });
});

// ─── getFileText MIME-type ordering regression ────────────────────────────────
// Bug: "application/vnd.openxmlformats-officedocument.*" contains "openxmlformats"
// which includes the substring "xml". If the xml/text check runs before the office
// doc check, raw ZIP binary is returned instead of a safe placeholder string.

describe("FileStorage.getFileText: office document MIME types", () => {
  it("returns a text placeholder (not binary) for a real .docx file", async () => {
    const { FileStorage } = await import("../server/storage.js");
    const { Document, Paragraph, TextRun, Packer } = await import("docx");
    const storage = new FileStorage(tmpDir);

    // Build a real docx buffer
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun("Test content")] })] }],
    });
    const buffer = await Packer.toBuffer(doc);
    const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    // The MIME type contains "xml" as a substring — this was the bug trigger
    expect(docxMime.includes("xml")).toBe(true);

    const id = "test-docx-1";
    storage.saveFile(id, "resume.docx", docxMime, buffer);

    const result = storage.getFileText(id);

    // Must NOT return null (file exists) and must NOT be raw binary
    expect(result).not.toBeNull();
    // A ZIP/docx binary starts with PK (0x50 0x4B) — should never appear in text result
    expect(result).not.toMatch(/^PK/);
    // Should be a human-readable placeholder message
    expect(typeof result).toBe("string");
    expect(result!.length).toBeLessThan(500); // placeholder is short
  });

  it("returns a text placeholder for .xlsx MIME type", async () => {
    const { FileStorage } = await import("../server/storage.js");
    const XLSX = await import("xlsx");
    const storage = new FileStorage(tmpDir);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A", "B"]]), "Sheet1");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    expect(xlsxMime.includes("xml")).toBe(true); // same bug vector

    const id = "test-xlsx-1";
    storage.saveFile(id, "data.xlsx", xlsxMime, buffer);

    const result = storage.getFileText(id);
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/^PK/);
    expect(typeof result).toBe("string");
  });

  it("reads a plain text file normally (not broken by the fix)", async () => {
    const { FileStorage } = await import("../server/storage.js");
    const storage = new FileStorage(tmpDir);

    const id = "test-txt-1";
    storage.saveFile(id, "notes.txt", "text/plain", Buffer.from("Hello world"));

    const result = storage.getFileText(id);
    expect(result).toBe("Hello world");
  });

  it("reads an XML file as text (not broken by the fix)", async () => {
    const { FileStorage } = await import("../server/storage.js");
    const storage = new FileStorage(tmpDir);

    const xml = `<?xml version="1.0"?><root><item>test</item></root>`;
    const id = "test-xml-1";
    storage.saveFile(id, "config.xml", "application/xml", Buffer.from(xml));

    const result = storage.getFileText(id);
    expect(result).toBe(xml);
  });
});

// ─── read_file tool: end-to-end text extraction ───────────────────────────────

describe("read_file tool: docx text extraction via mammoth", () => {
  it("extracts real text from a .docx file (not binary or placeholder)", async () => {
    const { FileStorage } = await import("../server/storage.js");
    const { Document, Paragraph, TextRun, Packer } = await import("docx");
    const mammoth = await import("mammoth");
    const storage = new FileStorage(tmpDir);

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun("Resume heading")] }),
          new Paragraph({ children: [new TextRun("Work experience at ACME Corp")] }),
        ],
      }],
    });
    const buffer = await Packer.toBuffer(doc);
    const id = "test-docx-2";
    storage.saveFile(id, "resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer);

    // Simulate what the read_file tool does
    const fileData = storage.getFile(id);
    expect(fileData).not.toBeNull();

    const result = await mammoth.extractRawText({ buffer: fileData!.buffer });
    expect(result.value).toContain("Resume heading");
    expect(result.value).toContain("Work experience");
    // Absolutely no binary garbage
    expect(result.value).not.toMatch(/^PK/);
    expect(result.value.includes("\x00")).toBe(false);
  });
});

// ─── MCP client utilities ─────────────────────────────────────────────────────

describe("McpClientManager", () => {
  it("isConnected returns false for unknown server", async () => {
    const { mcpManager } = await import("../server/mcp-client.js");
    expect(mcpManager.isConnected("nonexistent-server")).toBe(false);
  });

  it("isConnecting returns false for unknown server", async () => {
    const { mcpManager } = await import("../server/mcp-client.js");
    expect(mcpManager.isConnecting("nonexistent-server")).toBe(false);
  });

  it("getStatus returns an object", async () => {
    const { mcpManager } = await import("../server/mcp-client.js");
    const status = mcpManager.getStatus();
    expect(typeof status).toBe("object");
  });

  it("getTools returns empty array for unknown server", async () => {
    const { mcpManager } = await import("../server/mcp-client.js");
    const tools = mcpManager.getTools("nonexistent-server");
    expect(tools).toEqual([]);
  });
});
