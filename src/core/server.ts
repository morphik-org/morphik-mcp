import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MorphikConfig } from "./types.js";
import { registerMorphikTools } from "../tools/morphik-tools.js";
import { registerFileTools } from "../tools/file-tools.js";

// Create MCP server factory function
export function createMcpServer(config: MorphikConfig): McpServer {
  const server = new McpServer({
    name: "morphik",
    version: "1.0.0",
    capabilities: {
      tools: {},
    },
  });

  // Register all tools
  registerMorphikTools(server, config);
  registerFileTools(server, config);

  return server;
}