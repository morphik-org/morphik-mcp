#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig } from "./core/config.js";
import { createMcpServer } from "./core/server.js";

async function main() {
  // Parse configuration from command line arguments
  const config = parseConfig();
  
  // Create MCP server with configuration
  const server = createMcpServer(config);
  
  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error("Morphik MCP Server running on stdio");
  console.error(`File operations enabled: ${config.allowedDirectories.length} allowed ${config.allowedDirectories.length === 1 ? 'directory' : 'directories'}`);
  console.error(`Use --allowed-dir=dir1,dir2,... to specify allowed directories for file operations`);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
