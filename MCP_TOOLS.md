# Morphik MCP Tool Catalog

This document tracks every tool exposed by `@morphik/mcp`, how each one maps to Morphik API endpoints, and which upgrades we plan to ship next.

## Goals

1. Keep ingestion, retrieval, and document-management tools aligned with the production Morphik API surface.
2. Document folder/end-user scoping expectations so MCP clients know how to pass `folder_name` and metadata filters.
3. Capture upcoming work (chunk lookups, page ranges, typed filters) so MCP clients and Morphik app experience stay consistent.

---

## Tool Catalog

### Document Ingestion

| Tool | Purpose | Key Parameters | Morphik Endpoint |
| --- | --- | --- | --- |
| `ingest-text` | Push raw text into Morphik with optional metadata and ColPali embeddings. | `content`, `filename?`, `metadata?`, `folderName?`, `endUserId?`, `useColpali?` | `POST /ingest/text` |
| `ingest-file-from-path` | Stream a local file via multipart upload with optional folder/user scoping. | `path`, `metadata?`, `rules?`, `folderName?`, `endUserId?`, `useColpali?` | `POST /ingest/file` |
| `ingest-file-from-base64` | Upload using filename + base64 (for HTTP transports without disk access). | `filename`, `base64Content`, `metadata?`, `rules?`, `folderName?`, `endUserId?`, `useColpali?` | `POST /ingest/file` |
| `ingest-files-from-paths` | Batch multipart upload with arrays of files/metadata/rules. | `paths[]`, `metadata?`, `rules?`, `folderName?`, `endUserId?`, `useColpali?` | `POST /ingest/files` |

### Retrieval

| Tool | Purpose | Key Parameters | Morphik Endpoint |
| --- | --- | --- | --- |
| `retrieve-chunks` | Same behavior as `find_relevant_pages` in `@morphik-app`: returns the most relevant text/image pages for a query, with optional padding to grab neighbor pages. | `query`, `filters?`, `k?`, `minScore?`, `useColpali?`, `useReranking?`, `padding?`, `graphName?`, `hopDepth?`, `includePaths?`, `folderName?`, `endUserId?` | `POST /retrieve/chunks` |
| `retrieve-docs` | Semantic document search returning whole docs rather than chunks. | `query`, `filters?`, `k?`, `minScore?`, `useColpali?`, `useReranking?`, `padding?`, `graphName?`, `folderName?`, `endUserId?` | `POST /retrieve/docs` |
| `search-documents` | Full-text search for documents by filename or title. | `query`, `limit?`, `folderName?`, `endUserId?` | `POST /documents/search` |
| `get-pages-in-range` | Fetch inclusive page ranges (≤10 pages) for a document as Claude-ready blocks. | `documentId`, `startPage`, `endPage`, `folderName?`, `endUserId?` | `POST /documents/pages` |

### Document Management & Metadata

| Tool | Purpose | Key Parameters | Morphik Endpoint |
| --- | --- | --- | --- |
| `list-documents` | Rich `/documents/list_docs` flow with counts, selective fields, high-limit pagination, folder/end-user scoping. | `skip`, `limit`, `document_filters?`, `return_documents?`, `include_total_count?`, `fields?`, `folderName?`, `endUserId?`, `sort_by?`, `sort_direction?` | `POST /documents/list_docs` |
| `get-document` | Fetch metadata by external ID. | `documentId` | `GET /documents/{document_id}` |
| `delete-document` | Delete a document and all derived data. | `documentId` | `DELETE /documents/{document_id}` |
| `check-ingestion-status` | Poll ingestion/processing status. | `documentId` | `GET /documents/{document_id}/status` |
| `morphik-filters` | Manage typed metadata filters (`eq`, `regex`, `number_range`, `date_range`) that auto-apply to retrieval/list calls. | `action`, `expression/json`, `rules[]`, `logic?` | Internal metadata rules service |

### File-System Helpers

| Tool | Purpose | Key Parameters | Notes |
| --- | --- | --- | --- |
| `list-allowed-directories` | Show directories the MCP server can access. | — | Mirrors CLI `--allowed-dir` resolution. |
| `list-directory` | List files/subdirectories inside a validated path. | `path` | Uses `validatePath` to enforce sandbox. |
| `search-files` | Recursive name search with optional exclude globs. | `path`, `pattern`, `excludePatterns?` | Powered by `minimatch`. |
| `get-file-info` | Return stat metadata for any allowed path. | `path` | Reports size, timestamps, permissions. |

---

## Upcoming Improvements

Now that core ingestion, retrieval, metadata filters, and list-docs parity are in place, the remaining backlog items are:

1. **Graph & cache tooling:** expose Morphik graph creation/update/status endpoints plus cache helpers so MCP clients can manage structured knowledge, not just documents.
2. **Document mutations:** add tools for updating metadata/content (e.g., `update_document_with_text`, `delete_document_by_filename`) and generating download URLs.
3. **Workflow observability:** surface workflow status, usage metrics, and recent operations so MCP users can debug long-running ingestions without leaving their client.

---

## How to Use This Document

- **Developers:** Before adding or renaming a tool, update this file so the CLI README stays concise and points back here for the authoritative spec.
- **Tool Authors:** When wiring MCP tools into Claude or other clients, rely on the tables above to understand accepted parameters and expected behavior.
- **Product:** Use the “Upcoming Improvements” section to prioritize work and ensure the Node MCP server stays aligned with the Morphik app experience.
