/**
 * MCP Client Manager
 * 
 * Generic manager for MCP (Model Context Protocol) server connections.
 * Spawns MCP servers as child processes using stdio transport,
 * discovers their tools, and routes tool calls through them.
 * 
 * Supports any MCP-compatible server — Playwright, WorkIQ, etc.
 * Known server presets provide sensible defaults for common servers.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Config } from "@shared/schema";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: McpTool[];
  serverName: string;
}

export interface McpAuthMessage {
  serverName: string;
  message: string;
  url?: string;
  code?: string;
  timestamp: string;
}

/**
 * Known MCP server presets — provides sensible defaults for popular servers.
 * Users can override any of these via config, or add entirely custom servers.
 */
export interface McpServerPreset {
  label: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Additional args appended conditionally (e.g. --headless for Playwright) */
  optionalArgs?: (config: Config) => string[];
  /** Notes shown in UI about auth/setup requirements */
  setupNotes?: string;
  /** npm package to install globally (for display) */
  npmPackage?: string;
}

export const MCP_PRESETS: Record<string, McpServerPreset> = {
  playwright: {
    label: "Playwright",
    description: "Browser automation — navigate, click, fill forms, take screenshots",
    command: "npx",
    args: ["@playwright/mcp"],
    npmPackage: "@playwright/mcp",
    setupNotes: "Install globally: npm install -g @playwright/mcp",
  },
  workiq: {
    label: "WorkIQ (Microsoft 365)",
    description: "Access emails, meetings, documents, Teams messages, and people from Microsoft 365",
    command: "npx",
    args: ["-y", "@microsoft/workiq", "mcp"],
    npmPackage: "@microsoft/workiq",
    setupNotes: "Requires Microsoft 365 + Copilot license. Run 'npx @microsoft/workiq accept-eula' first, then authenticate with your Microsoft Entra account. Optional: add --tenant-id <id> in args.",
  },
};

class McpClientManager {
  private connections = new Map<string, McpConnection>();
  private connecting = new Map<string, Promise<McpConnection>>();
  /** Auth messages captured from MCP server stderr (device code flow, login URLs, etc.) */
  authMessages: McpAuthMessage[] = [];

  /**
   * Connect to an MCP server by name.
   * If already connected, returns existing connection.
   */
  async connect(
    serverName: string,
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
  ): Promise<McpConnection> {
    // Already connected
    const existing = this.connections.get(serverName);
    if (existing) return existing;

    // Already connecting (avoid duplicate spawns)
    const pending = this.connecting.get(serverName);
    if (pending) return pending;

    const promise = this._doConnect(serverName, command, args, env);
    this.connecting.set(serverName, promise);

    try {
      const conn = await promise;
      this.connections.set(serverName, conn);
      return conn;
    } finally {
      this.connecting.delete(serverName);
    }
  }

  private async _doConnect(
    serverName: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<McpConnection> {
    console.log(`[MCP] Connecting to "${serverName}" via: ${command} ${args.join(" ")}`);

    const transport = new StdioClientTransport({
      command,
      args,
      env: env ? { ...process.env as Record<string, string>, ...env } : undefined,
      stderr: "pipe",
    });

    // Capture stderr for auth messages (device code flow, login URLs)
    const stderr = transport.stderr;
    if (stderr) {
      let buffer = "";
      stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        buffer += text;
        console.log(`[MCP:${serverName}:stderr] ${text.trim()}`);
        // Detect auth URLs or device codes
        const urlMatch = text.match(/(https?:\/\/[^\s]+)/g);
        const codeMatch = text.match(/code[:\s]+([A-Z0-9]{6,})/i);
        if (urlMatch || codeMatch) {
          this.authMessages.push({
            serverName,
            message: buffer.trim(),
            url: urlMatch?.[0],
            code: codeMatch?.[1],
            timestamp: new Date().toISOString(),
          });
          // Keep only last 10 messages
          if (this.authMessages.length > 10) this.authMessages.shift();
          buffer = "";
        }
      });
    }

    const client = new Client({
      name: "cortex",
      version: "2.0.0",
    });

    await client.connect(transport);

    // Discover tools
    const toolsResult = await client.listTools();
    const tools: McpTool[] = (toolsResult.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || {},
    }));

    console.log(`[MCP] Connected to "${serverName}" — ${tools.length} tools available: ${tools.map(t => t.name).join(", ")}`);

    return { client, transport, tools, serverName };
  }

  /**
   * Call a tool on a connected MCP server.
   * Returns the text content of the result.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server "${serverName}" is not connected. Configure it in Settings > General > MCP Servers.`);
    }

    const result = await conn.client.callTool({ name: toolName, arguments: args });

    // Extract content from the result
    const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    if (!content || content.length === 0) return "OK (no output)";

    const parts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) {
        parts.push(block.text);
      } else if (block.type === "image" && block.data) {
        // Return base64 image data marker so agent can handle it
        parts.push(`[screenshot:${block.mimeType || "image/png"}:${block.data.slice(0, 100)}...]`);
      } else {
        parts.push(JSON.stringify(block));
      }
    }
    return parts.join("\n");
  }

  /**
   * Get all tools from a specific server, or all connected servers.
   */
  getTools(serverName?: string): McpTool[] {
    if (serverName) {
      return this.connections.get(serverName)?.tools || [];
    }
    const all: McpTool[] = [];
    Array.from(this.connections.values()).forEach(conn => {
      all.push(...conn.tools);
    });
    return all;
  }

  /**
   * Find which server provides a given tool name.
   */
  findServerForTool(toolName: string): string | null {
    for (const [name, conn] of Array.from(this.connections.entries())) {
      if (conn.tools.some((t: McpTool) => t.name === toolName)) return name;
    }
    return null;
  }

  /**
   * Get tools grouped by server name.
   * Returns a map of server name -> tools array.
   */
  getToolsByServer(): Map<string, McpTool[]> {
    const result = new Map<string, McpTool[]>();
    Array.from(this.connections.entries()).forEach(([name, conn]) => {
      result.set(name, conn.tools);
    });
    return result;
  }

  /**
   * Check if a server is connected.
   */
  isConnected(serverName: string): boolean {
    return this.connections.has(serverName);
  }

  /**
   * Disconnect a specific server.
   */
  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;
    try {
      await conn.transport.close();
    } catch (e) {
      // Ignore close errors
    }
    this.connections.delete(serverName);
    console.log(`[MCP] Disconnected from "${serverName}"`);
  }

  /**
   * Disconnect all servers.
   */
  async disconnectAll(): Promise<void> {
    for (const name of Array.from(this.connections.keys())) {
      await this.disconnect(name);
    }
  }

  /**
   * Resolve the command/args for a named server.
   * Checks config.mcpServers first, then falls back to known presets.
   * For Playwright, also handles --headless flag from vault settings.
   */
  resolveServerConfig(
    serverName: string,
    config: Config,
    headless: boolean = false,
  ): { command: string; args: string[]; env?: Record<string, string> } | null {
    // Check user config first (explicit overrides)
    const userConfig = config.mcpServers?.[serverName];
    if (userConfig) {
      let args = [...userConfig.args];
      // For playwright, append --headless if needed
      if (serverName === "playwright" && headless && !args.includes("--headless")) {
        args.push("--headless");
      }
      return { command: userConfig.command, args, env: userConfig.env };
    }

    // Fall back to presets
    const preset = MCP_PRESETS[serverName];
    if (preset) {
      let args = [...preset.args];
      if (serverName === "playwright" && headless) {
        args.push("--headless");
      }
      return { command: preset.command, args, env: preset.env };
    }

    return null;
  }

  /**
   * Connect a single server by name, using config + preset resolution.
   */
  async connectServer(
    serverName: string,
    config: Config,
    headless: boolean = false,
  ): Promise<boolean> {
    if (this.isConnected(serverName)) return true;

    const resolved = this.resolveServerConfig(serverName, config, headless);
    if (!resolved) {
      console.error(`[MCP] No config or preset found for server "${serverName}"`);
      return false;
    }

    try {
      await this.connect(serverName, resolved.command, resolved.args, resolved.env);
      return true;
    } catch (err: any) {
      console.error(`[MCP] Failed to connect to "${serverName}": ${err.message}`);
      return false;
    }
  }

  /**
   * Initialize all MCP servers from config.
   * Connects servers listed in config.mcpServers.
   * Also handles legacy browserBackend field for backward compatibility.
   */
  async initFromConfig(config: Config, headless: boolean = false): Promise<void> {
    // Handle legacy browserBackend field
    if (config.browserBackend === "playwright-mcp") {
      if (!this.isConnected("playwright")) {
        await this.connectServer("playwright", config, headless);
      }
    } else {
      // Browser disabled — disconnect if was previously connected
      if (this.isConnected("playwright")) {
        await this.disconnect("playwright");
      }
    }

    // Connect all servers in mcpServers config
    for (const serverName of Object.keys(config.mcpServers || {})) {
      if (serverName === "playwright") continue; // Already handled above
      if (!this.isConnected(serverName)) {
        await this.connectServer(serverName, config, headless);
      }
    }
  }

  /**
   * Initialize the Playwright MCP server based on config.
   * Backward-compatible convenience method.
   */
  async initPlaywright(config: Config, headless: boolean = false): Promise<boolean> {
    if (config.browserBackend !== "playwright-mcp") {
      if (this.isConnected("playwright")) {
        await this.disconnect("playwright");
      }
      return false;
    }

    return this.connectServer("playwright", config, headless);
  }

  /**
   * Get connection status summary for the UI.
   * Includes both connected servers and configured-but-not-connected servers.
   */
  getStatus(config?: Config): Record<string, { connected: boolean; tools: string[]; label: string; description: string; setupNotes?: string }> {
    const status: Record<string, { connected: boolean; tools: string[]; label: string; description: string; setupNotes?: string }> = {};

    // Add connected servers
    Array.from(this.connections.entries()).forEach(([name, conn]) => {
      const preset = MCP_PRESETS[name];
      status[name] = {
        connected: true,
        tools: conn.tools.map((t: McpTool) => t.name),
        label: preset?.label || name,
        description: preset?.description || `MCP server: ${name}`,
        setupNotes: preset?.setupNotes,
      };
    });

    // Add configured but not yet connected servers
    if (config?.mcpServers) {
      for (const name of Object.keys(config.mcpServers)) {
        if (!status[name]) {
          const preset = MCP_PRESETS[name];
          status[name] = {
            connected: false,
            tools: [],
            label: preset?.label || name,
            description: preset?.description || `MCP server: ${name}`,
            setupNotes: preset?.setupNotes,
          };
        }
      }
    }

    // Add playwright if enabled via legacy field
    if (config?.browserBackend === "playwright-mcp" && !status["playwright"]) {
      const preset = MCP_PRESETS["playwright"];
      status["playwright"] = {
        connected: false,
        tools: [],
        label: preset.label,
        description: preset.description,
        setupNotes: preset.setupNotes,
      };
    }

    return status;
  }

  /**
   * Get info about all known presets (for the UI to display as options).
   */
  getPresets(): Record<string, { label: string; description: string; setupNotes?: string; npmPackage?: string }> {
    const result: Record<string, { label: string; description: string; setupNotes?: string; npmPackage?: string }> = {};
    for (const [name, preset] of Object.entries(MCP_PRESETS)) {
      result[name] = {
        label: preset.label,
        description: preset.description,
        setupNotes: preset.setupNotes,
        npmPackage: preset.npmPackage,
      };
    }
    return result;
  }
}

// Singleton
export const mcpManager = new McpClientManager();
