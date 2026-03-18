/**
 * MCP Client Manager
 * 
 * Manages connections to MCP servers (e.g. Playwright browser automation).
 * Spawns MCP servers as child processes using stdio transport,
 * discovers their tools, and routes tool calls through them.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Config } from "@shared/schema";

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: McpTool[];
  serverName: string;
}

class McpClientManager {
  private connections = new Map<string, McpConnection>();
  private connecting = new Map<string, Promise<McpConnection>>();

  /**
   * Connect to an MCP server by name. If already connected, returns existing connection.
   * The server config comes from the global config's mcpServers map.
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
      throw new Error(`MCP server "${serverName}" is not connected. Configure it in Settings > General > Browser Backend.`);
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
    for (const conn of this.connections.values()) {
      all.push(...conn.tools);
    }
    return all;
  }

  /**
   * Find which server provides a given tool name.
   */
  findServerForTool(toolName: string): string | null {
    for (const [name, conn] of this.connections) {
      if (conn.tools.some(t => t.name === toolName)) return name;
    }
    return null;
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
   * Initialize the Playwright MCP server based on config.
   * This is the main entry point called at startup or when settings change.
   */
  async initPlaywright(config: Config, headless: boolean = false): Promise<boolean> {
    if (config.browserBackend !== "playwright-mcp") {
      // Browser not enabled; disconnect if was previously connected
      if (this.isConnected("playwright")) {
        await this.disconnect("playwright");
      }
      return false;
    }

    // Already connected
    if (this.isConnected("playwright")) return true;

    // Check if there's a custom MCP server config for playwright
    const customConfig = config.mcpServers?.["playwright"];
    
    const command = customConfig?.command || "npx";
    const args = customConfig?.args || ["@playwright/mcp", ...(headless ? ["--headless"] : [])];
    const env = customConfig?.env;

    try {
      await this.connect("playwright", command, args, env);
      return true;
    } catch (err: any) {
      console.error(`[MCP] Failed to connect to Playwright: ${err.message}`);
      return false;
    }
  }

  /**
   * Get connection status summary for the UI.
   */
  getStatus(): Record<string, { connected: boolean; tools: string[] }> {
    const status: Record<string, { connected: boolean; tools: string[] }> = {};
    for (const [name, conn] of this.connections) {
      status[name] = {
        connected: true,
        tools: conn.tools.map(t => t.name),
      };
    }
    return status;
  }
}

// Singleton
export const mcpManager = new McpClientManager();
