import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@microsoft/workiq", "mcp"],
  stderr: "pipe",
});

let stderrData = "";
transport.stderr?.on("data", (chunk) => {
  stderrData += chunk.toString();
  console.log("[STDERR]", chunk.toString().trim());
});

const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("Full tool schemas:");
for (const t of tools.tools) {
  console.log(`\n=== ${t.name} ===`);
  console.log("Description:", t.description);
  console.log("Input schema:", JSON.stringify(t.inputSchema, null, 2));
}

await transport.close();
