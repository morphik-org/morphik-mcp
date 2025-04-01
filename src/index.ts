import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MORPHIK_API_BASE = "https://api.morphik.ai"; // Base URL for Morphik API
const USER_AGENT = "morphik-mcp/1.0";

// Helper function for making Morphik API requests
export async function makeMorphikRequest<T>({
  url,
  method = "GET",
  body = undefined,
  apiKey = undefined,
  isMultipart = false,
}: {
  url: string;
  method?: string;
  body?: any;
  apiKey?: string;
  isMultipart?: boolean;
}): Promise<T | null> {
  const fullUrl = url.startsWith("http") ? url : `${MORPHIK_API_BASE}${url}`;
  
  // Prepare headers based on content type and authorization
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
  };
  
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  
  if (!isMultipart && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  
  try {
    // Prepare request options
    const requestOptions: RequestInit = {
      method,
      headers,
    };
    
    // Add body if provided
    if (body !== undefined) {
      if (isMultipart) {
        // For multipart requests, body should be FormData
        requestOptions.body = body;
      } else {
        // For JSON requests, stringify the body
        requestOptions.body = JSON.stringify(body);
      }
    }
    
    // Make the request
    const response = await fetch(fullUrl, requestOptions);
    
    // Check for HTTP errors
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    
    // Parse and return JSON response
    return await response.json() as T;
  } catch (error) {
    console.error("Error making Morphik request:", error);
    return null;
  }
}

// Morphik API interfaces based on OpenAPI spec
interface Document {
  external_id?: string;
  owner: Record<string, string>;
  content_type: string;
  filename?: string;
  metadata: Record<string, any>;
  storage_info?: Record<string, string>;
  storage_files?: StorageFileInfo[];
  system_metadata?: Record<string, any>;
  additional_metadata?: Record<string, any>;
  access_control?: Record<string, string[]>;
  chunk_ids?: string[];
}

interface StorageFileInfo {
  bucket: string;
  key: string;
  version?: number;
  filename?: string;
  content_type?: string;
  timestamp?: string;
}

interface IngestTextRequest {
  content: string;
  filename?: string;
  metadata?: Record<string, any>;
  rules?: any[];
  use_colpali?: boolean;
}

interface ChunkResult {
  content: string;
  score: number;
  document_id: string;
  chunk_number: number;
  metadata: Record<string, any>;
  content_type: string;
  filename?: string;
  download_url?: string;
}

interface DocumentResult {
  score: number;
  document_id: string;
  metadata: Record<string, any>;
  content: DocumentContent;
  additional_metadata: Record<string, any>;
}

interface DocumentContent {
  type: "url" | "string";
  value: string;
  filename?: string;
}

interface CompletionQueryRequest {
  query: string;
  filters?: Record<string, any>;
  k?: number;
  min_score?: number;
  use_reranking?: boolean;
  use_colpali?: boolean;
  graph_name?: string;
  hop_depth?: number;
  include_paths?: boolean;
  max_tokens?: number;
  temperature?: number;
}

interface CompletionResponse {
  completion: string;
  usage: Record<string, number>;
  finish_reason?: string;
  sources?: ChunkSource[];
  metadata?: Record<string, any>;
}

interface ChunkSource {
  document_id: string;
  chunk_number: number;
  score?: number;
}

interface RetrieveRequest {
  query: string;
  filters?: Record<string, any>;
  k?: number;
  min_score?: number;
  use_reranking?: boolean;
  use_colpali?: boolean;
  graph_name?: string;
  hop_depth?: number;
  include_paths?: boolean;
}

// Create server instance
const server = new McpServer({
  name: "morphik",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register Morphik tools

// 1. Ingest Text Document
server.tool(
  "ingest-text",
  "Ingest a text document into Morphik",
  {
    content: z.string().describe("Text content to ingest"),
    filename: z.string().optional().describe("Optional filename to help determine content type"),
    metadata: z.record(z.any()).optional().describe("Optional metadata dictionary"),
    apiKey: z.string().describe("Morphik API key for authentication"),
  },
  async ({ content, filename, metadata, apiKey }) => {
    // Prepare request body
    const requestBody: IngestTextRequest = {
      content,
      filename,
      metadata: metadata || {},
    };

    // Make API request
    const response = await makeMorphikRequest<Document>({
      url: "/ingest/text",
      method: "POST",
      body: requestBody,
      apiKey,
    });

    if (!response) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to ingest text document",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Successfully ingested document with ID: ${response.external_id}`,
        },
      ],
    };
  },
);

// 2. Document Retrieval (Chunks)
server.tool(
  "retrieve-chunks",
  "Retrieve relevant chunks from Morphik based on a query",
  {
    query: z.string().describe("The search query"),
    filters: z.record(z.any()).optional().describe("Optional metadata filters"),
    k: z.number().optional().describe("Number of results to return (default: 4)"),
    minScore: z.number().optional().describe("Minimum relevance score (default: 0)"),
    apiKey: z.string().describe("Morphik API key for authentication"),
  },
  async ({ query, filters, k, minScore, apiKey }) => {
    // Prepare request body
    const requestBody: RetrieveRequest = {
      query,
      filters: filters || {},
      k: k || 4,
      min_score: minScore || 0,
    };

    // Make API request
    const response = await makeMorphikRequest<ChunkResult[]>({
      url: "/retrieve/chunks",
      method: "POST",
      body: requestBody,
      apiKey,
    });

    if (!response || response.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No relevant chunks found for the query",
          },
        ],
      };
    }

    // Format the results
    const chunks = response.map(chunk => {
      return `[Score: ${chunk.score.toFixed(2)}] ${chunk.content}\n(Document: ${chunk.document_id}, Chunk: ${chunk.chunk_number})`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Retrieved ${response.length} chunks:\n\n${chunks.join("\n\n")}`,
        },
      ],
    };
  },
);

// 3. Document Retrieval (Documents)
server.tool(
  "retrieve-docs",
  "Retrieve relevant documents from Morphik based on a query",
  {
    query: z.string().describe("The search query"),
    filters: z.record(z.any()).optional().describe("Optional metadata filters"),
    k: z.number().optional().describe("Number of results to return (default: 4)"),
    minScore: z.number().optional().describe("Minimum relevance score (default: 0)"),
    apiKey: z.string().describe("Morphik API key for authentication"),
  },
  async ({ query, filters, k, minScore, apiKey }) => {
    // Prepare request body
    const requestBody: RetrieveRequest = {
      query,
      filters: filters || {},
      k: k || 4,
      min_score: minScore || 0,
    };

    // Make API request
    const response = await makeMorphikRequest<DocumentResult[]>({
      url: "/retrieve/docs",
      method: "POST",
      body: requestBody,
      apiKey,
    });

    if (!response || response.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No relevant documents found for the query",
          },
        ],
      };
    }

    // Format the results
    const docs = response.map(doc => {
      const content = doc.content.type === "url" 
        ? `[URL: ${doc.content.value}]` 
        : doc.content.value.substring(0, 100) + "...";
      
      return `[Score: ${doc.score.toFixed(2)}] ${content}\n(Document ID: ${doc.document_id})`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Retrieved ${response.length} documents:\n\n${docs.join("\n\n")}`,
        },
      ],
    };
  },
);

// 4. Query Completion
server.tool(
  "query",
  "Generate a completion using relevant chunks as context",
  {
    query: z.string().describe("The user's question"),
    filters: z.record(z.any()).optional().describe("Optional metadata filters"),
    k: z.number().optional().describe("Number of chunks to use (default: 4)"),
    maxTokens: z.number().optional().describe("Maximum number of tokens to generate"),
    temperature: z.number().optional().describe("Temperature for generation"),
    apiKey: z.string().describe("Morphik API key for authentication"),
  },
  async ({ query, filters, k, maxTokens, temperature, apiKey }) => {
    // Prepare request body
    const requestBody: CompletionQueryRequest = {
      query,
      filters: filters || {},
      k: k || 4,
      max_tokens: maxTokens,
      temperature,
    };

    // Make API request
    const response = await makeMorphikRequest<CompletionResponse>({
      url: "/query",
      method: "POST",
      body: requestBody,
      apiKey,
    });

    if (!response) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to generate completion",
          },
        ],
      };
    }

    // Format sources if available
    let sourcesText = "";
    if (response.sources && response.sources.length > 0) {
      sourcesText = "\n\nSources:\n" + response.sources.map(source => 
        `- Document ${source.document_id}, Chunk ${source.chunk_number}${source.score ? ` (Score: ${source.score.toFixed(2)})` : ""}`
      ).join("\n");
    }

    return {
      content: [
        {
          type: "text",
          text: response.completion + sourcesText,
        },
      ],
    };
  },
);

// 5. List Documents
server.tool(
  "list-documents",
  "List documents in Morphik",
  {
    skip: z.number().optional().describe("Number of documents to skip (default: 0)"),
    limit: z.number().optional().describe("Maximum number of documents to return (default: 10)"),
    filters: z.record(z.any()).optional().describe("Optional metadata filters"),
    apiKey: z.string().describe("Morphik API key for authentication"),
  },
  async ({ skip, limit, filters, apiKey }) => {
    // Prepare URL with query parameters
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());
    
    const url = `/documents?${params.toString()}`;
    
    // Make API request
    const response = await makeMorphikRequest<Document[]>({
      url,
      method: "POST", // POST because we need to send a filters object in the body
      body: filters || {},
      apiKey,
    });

    if (!response || response.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No documents found",
          },
        ],
      };
    }

    // Format the results
    const docs = response.map(doc => {
      return `ID: ${doc.external_id || "Unknown"}\nType: ${doc.content_type}\nFilename: ${doc.filename || "None"}\nMetadata: ${JSON.stringify(doc.metadata, null, 2)}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${response.length} documents:\n\n${docs.join("\n\n")}`,
        },
      ],
    };
  },
);

// Helper function to format document response
export function processDocumentResponse(doc: Document): string {
  const details = [
    `ID: ${doc.external_id || "Unknown"}`,
    `Type: ${doc.content_type}`,
    `Filename: ${doc.filename || "None"}`,
    `Metadata: ${JSON.stringify(doc.metadata, null, 2)}`,
  ];

  if (doc.chunk_ids && doc.chunk_ids.length > 0) {
    details.push(`Chunks: ${doc.chunk_ids.length}`);
  }

  return details.join("\n");
}

// 6. Get Document
server.tool(
  "get-document",
  "Get a specific document from Morphik by ID",
  {
    documentId: z.string().describe("ID of the document to retrieve"),
    apiKey: z.string().describe("Morphik API key for authentication"),
  },
  async ({ documentId, apiKey }) => {
    // Make API request
    const response = await makeMorphikRequest<Document>({
      url: `/documents/${documentId}`,
      method: "GET",
      apiKey,
    });

    if (!response) {
      return {
        content: [
          {
            type: "text",
            text: `Document with ID ${documentId} not found`,
          },
        ],
      };
    }

    // Format the document details using the helper function
    return {
      content: [
        {
          type: "text",
          text: processDocumentResponse(response),
        },
      ],
    };
  },
);

// 7. Delete Document
server.tool(
  "delete-document",
  "Delete a document from Morphik by ID",
  {
    documentId: z.string().describe("ID of the document to delete"),
    apiKey: z.string().describe("Morphik API key for authentication"),
  },
  async ({ documentId, apiKey }) => {
    // Make API request
    const response = await makeMorphikRequest<any>({
      url: `/documents/${documentId}`,
      method: "DELETE",
      apiKey,
    });

    if (!response) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to delete document with ID ${documentId}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Successfully deleted document with ID ${documentId}`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Morphik MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});