# Morphik MCP

A Model Context Protocol (MCP) server implementation for Morphik multi-modal database.

## Overview

This MCP server allows Claude and other MCP-compatible AI assistants to interact with the Morphik database system, enabling:

- Document ingestion (text and files)
- Document retrieval (by relevance to queries)
- Document querying with LLM-powered completions
- Document management (listing, getting, deleting)

## Installation

```bash
npm install
npm run build
```

## Usage

Start the MCP server:

```bash
npm start
```

The server runs on standard input/output streams and can be used with MCP clients like Claude.

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