# Morphik MCP

A Model Context Protocol (MCP) server implementation for Morphik multi-modal database.

## Overview

This MCP server allows Claude and other MCP-compatible AI assistants to interact with the Morphik database system, enabling:

- Document ingestion (text and files)
- Document retrieval (by relevance to queries)
- Document querying with LLM-powered completions
- Document management (listing, getting, deleting)

## Prerequisites

You need access to either:
- A local Morphik server running on localhost:8000, or
- The Morphik cloud platform

## Installation & Usage

### Option 1: Run directly with npx (recommended)

```bash
# Connect to local Morphik server
npx morphik-mcp

# Connect to Morphik cloud platform (replace with your actual URI)
npx morphik-mcp --uri=https://api.morphik.ai
```

### Option 2: Global installation

```bash
npm install -g morphik-mcp

# Connect to local Morphik server
morphik-mcp

# Connect to Morphik cloud platform
morphik-mcp --uri=https://api.morphik.ai
```

### Option 3: Local development

```bash
# Clone the repository
git clone https://github.com/morphik-org/morphik-npm-mcp.git
cd morphik-npm-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Start the server (local Morphik)
npm start

# Start the server (Morphik cloud)
node build/index.js --uri=https://api.morphik.ai
```

The server runs on standard input/output streams and can be used with MCP clients like Claude.

## Usage with Claude Desktop

Add this to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "morphik-local": {
      "command": "npx",
      "args": ["-y", "morphik-mcp"]
    },
    "morphik-cloud": {
      "command": "npx",
      "args": ["-y", "morphik-mcp", "--uri=https://api.morphik.ai"]
    }
  }
}
```

## MCP Tools

The server provides the following tools:

### 1. Document Ingestion

- `ingest-text`: Ingest a text document into Morphik
  - Parameters: content, filename (optional), metadata (optional), apiKey

### 2. Document Retrieval

- `retrieve-chunks`: Retrieve relevant chunks from Morphik based on a query
  - Parameters: query, filters (optional), k (optional), minScore (optional), apiKey

- `retrieve-docs`: Retrieve relevant documents from Morphik based on a query
  - Parameters: query, filters (optional), k (optional), minScore (optional), apiKey

### 3. Document Querying

- `query`: Generate a completion using relevant chunks as context
  - Parameters: query, filters (optional), k (optional), maxTokens (optional), temperature (optional), apiKey

### 4. Document Management

- `list-documents`: List documents in Morphik
  - Parameters: skip (optional), limit (optional), filters (optional), apiKey

- `get-document`: Get a specific document from Morphik by ID
  - Parameters: documentId, apiKey

- `delete-document`: Delete a document from Morphik by ID
  - Parameters: documentId, apiKey

## Development

Build the project:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run manual tests:

```bash
npm run test:manual
```

## License

ISC