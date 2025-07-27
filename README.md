# Morphik MCP

A Model Context Protocol (MCP) server implementation for Morphik multi-modal database.

## Overview

This MCP server allows Claude and other MCP-compatible AI assistants to interact with the Morphik database system, enabling:

- Document ingestion (text and files)
- Document retrieval (by relevance to queries)
- Document querying with LLM-powered completions
- Document management (listing, getting, deleting)
- File system navigation and file ingestion from paths

The server supports two transport modes:
- **stdio** (default): Standard input/output for use with Claude Desktop and other MCP clients
- **Streamable HTTPS**: HTTP/HTTPS endpoint for web-based integrations

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

# Specify allowed directories for file operations (comma-separated)
npx morphik-mcp --allowed-dir=~/Documents,~/Downloads
```

### Option 2: Global installation

```bash
npm install -g morphik-mcp

# Connect to local Morphik server
morphik-mcp

# Connect to Morphik cloud platform
morphik-mcp --uri=https://api.morphik.ai

# Specify allowed directories for file operations
morphik-mcp --allowed-dir=~/Documents,~/Downloads
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

# Start the server with file operations enabled
node build/index.js --allowed-dir=~/Documents,~/Downloads
```

The server runs on standard input/output streams by default and can be used with MCP clients like Claude.

For HTTP/HTTPS mode (streamable), see the [streamable_https.md](streamable_https.md) documentation.

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
    },
    "morphik-with-files": {
      "command": "npx",
      "args": ["-y", "morphik-mcp", "--allowed-dir=~/Documents,~/Downloads"]
    }
  }
}
```

## MCP Tools

The server provides the following tools:

### 1. Document Ingestion

- `ingest-text`: Ingest a text document into Morphik
  - Parameters: content, filename (optional), metadata (optional), apiKey

- `ingest-file-from-path`: Ingest a file from the server's filesystem into Morphik
  - Parameters: path, metadata (optional), rules (optional), folderName (optional), endUserId (optional), useColpali (optional)

- `ingest-files-from-paths`: Batch ingest multiple files from the server's filesystem
  - Parameters: paths, metadata (optional), rules (optional), folderName (optional), endUserId (optional), useColpali (optional)

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

### 5. File System Navigation

- `list-allowed-directories`: List directories that the server is allowed to access
  - Parameters: none

- `list-directory`: List files and subdirectories in a specific directory
  - Parameters: path

- `search-files`: Search for files matching a pattern in a directory and its subdirectories
  - Parameters: path, pattern, excludePatterns (optional)

- `get-file-info`: Get detailed information about a file or directory
  - Parameters: path

## File Operations Security

For security reasons, file operations are restricted to directories explicitly allowed when starting the server using the `--allowed-dir` parameter. If no directories are specified, only the user's home directory will be accessible.

The server validates all file paths to ensure they're within allowed directories, preventing access to sensitive system files. Symlinks are also checked to ensure they don't point outside allowed directories.

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