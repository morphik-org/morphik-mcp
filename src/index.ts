import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MORPHIK_API_BASE = "http://localhost:8000"; // Base URL for Morphik API
const USER_AGENT = "morphik-mcp/1.0";

// Helper function for making Morphik API requests
export async function makeMorphikRequest<T>({
  url,
  method = "GET",
  body = undefined,
  isMultipart = false,
}: {
  url: string;
  method?: string;
  body?: any;
  isMultipart?: boolean;
}): Promise<T | null> {
  const fullUrl = url.startsWith("http") ? url : `${MORPHIK_API_BASE}${url}`;
  
  // Prepare headers based on content type and authorization
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
  };
  
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
  "Unlock knowledge retrieval by seamlessly adding text content to Morphik's powerful knowledge base. This essential first step ensures your valuable information becomes instantly searchable, helping users find exactly what they need. Perfect for documentation, research findings, support articles, or any text that needs to be discoverable.",
  {
    content: z.string().describe("Text content to ingest"),
    filename: z.string().optional().describe("Optional filename to help determine content type"),
    metadata: z.record(z.any()).optional().describe("Optional metadata dictionary"),
  },
  async ({ content, filename, metadata }) => {
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
  "IMPORTANT: Use this tool for EVERY user question that requires factual information or knowledge retrieval. This essential tool finds the most relevant content chunks from your knowledge base, providing precise, accurate, and up-to-date information to answer user questions. By retrieving specific text segments rather than entire documents, you'll get exactly the context needed for accurate responses while maintaining source attribution. Always use this tool first before answering knowledge-based questions to ensure responses are grounded in your actual data.",
  {
    query: z.string().describe("The search query"),
    filters: z.record(z.any()).optional().describe("Optional metadata filters"),
    k: z.number().optional().describe("Number of results to return (default: 4)"),
    minScore: z.number().optional().describe("Minimum relevance score (default: 0)"),
  },
  async ({ query, filters, k, minScore }) => {
    // Prepare request body
    const requestBody: RetrieveRequest = {
      query,
      filters: filters || {},
      k: k || 4,
      min_score: minScore || 0,
      use_colpali: true, // Enable colpali by default
    };

    // Make API request
    const response = await makeMorphikRequest<ChunkResult[]>({
      url: "/retrieve/chunks",
      method: "POST",
      body: requestBody,
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

    // Format the results with support for images
    const contentItems = response.map(chunk => {
      // For images, check if metadata indicates it's an image
      if (chunk.metadata && chunk.metadata.is_image === true) {
        // Extract the base64 data from the data URI (remove the prefix if present)
        let imageData = chunk.content;
        if (imageData.startsWith('data:')) {
          // Remove the prefix (e.g., "data:image/png;base64,")
          imageData = imageData.split(',')[1] || imageData;
        }
        
        // Create a data URI for the image
        const dataUri = `data:image/png;base64,${imageData}`;
        
        return {
          type: "resource" as const,
          resource: {
            uri: dataUri,
            mimeType: "image/png", // Images are always PNG
            blob: imageData
          }
        };
      }
      
      // For text content
      return {
        type: "text" as const,
        text: `[Score: ${chunk.score.toFixed(2)}] ${chunk.content}\n(Document: ${chunk.document_id}, Chunk: ${chunk.chunk_number})`
      };
    });

    // Add summary text at the beginning
    contentItems.unshift({
      type: "text" as const,
      text: `Retrieved ${response.length} chunks:`
    });

    return {
      content: contentItems,
    };
  },
);

// 3. Document Retrieval (Documents)
server.tool(
  "retrieve-docs",
  "Access complete documents relevant to user questions with this powerful semantic search capability. Unlike chunk retrieval, this tool returns entire documents, making it ideal for situations requiring comprehensive context or when you need to understand full articles, manuals, or reports. The advanced matching algorithm ensures you receive the most valuable documents based on semantic meaning rather than just keyword matching, dramatically improving the quality and relevance of your responses.",
  {
    query: z.string().describe("The search query"),
    filters: z.record(z.any()).optional().describe("Optional metadata filters"),
    k: z.number().optional().describe("Number of results to return (default: 4)"),
    minScore: z.number().optional().describe("Minimum relevance score (default: 0)"),
  },
  async ({ query, filters, k, minScore }) => {
    // Prepare request body
    const requestBody: RetrieveRequest = {
      query,
      filters: filters || {},
      k: k || 4,
      min_score: minScore || 0,
      use_colpali: true, // Enable colpali by default
    };

    // Make API request
    const response = await makeMorphikRequest<DocumentResult[]>({
      url: "/retrieve/docs",
      method: "POST",
      body: requestBody,
    });

    if (!response || response.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No relevant documents found for the query",
          },
        ],
      };
    }

    // Format the results, handling potential image content
    const contentItems = response.map(doc => {
      const content = doc.content.type === "url" 
        ? `[URL: ${doc.content.value}]` 
        : doc.content.value.substring(0, 100) + "...";
      
      return {
        type: "text" as const,
        text: `[Score: ${doc.score.toFixed(2)}] ${content}\n(Document ID: ${doc.document_id})`
      };
    });

    // Add summary text at the beginning
    contentItems.unshift({
      type: "text" as const,
      text: `Retrieved ${response.length} documents:`
    });

    return {
      content: contentItems,
    };
  },
);

// 4. List Documents
server.tool(
  "list-documents",
  "Gain complete visibility into your knowledge base by exploring all available documents in the Morphik system. This tool provides a comprehensive overview of your content, allowing you to discover what information is available, understand document metadata, and identify knowledge gaps. Use this tool to help users understand what types of questions can be effectively answered based on your current knowledge repository.",
  {
    skip: z.number().optional().describe("Number of documents to skip (default: 0)"),
    limit: z.number().optional().describe("Maximum number of documents to return (default: 10)"),
    filters: z.record(z.any()).optional().describe("Optional metadata filters"),
  },
  async ({ skip, limit, filters }) => {
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

// 5. Get Document
server.tool(
  "get-document",
  "Access detailed information about specific documents in your knowledge base with this powerful retrieval tool. When you need comprehensive metadata, content details, or want to verify document attributes before providing information to users, this tool delivers the complete picture. Use it to confirm document existence, check metadata fields, or verify that specific information sources are available before promising answers on particular topics.",
  {
    documentId: z.string().describe("ID of the document to retrieve"),
  },
  async ({ documentId }) => {
    // Make API request
    const response = await makeMorphikRequest<Document>({
      url: `/documents/${documentId}`,
      method: "POST",
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

// 6. Delete Document
server.tool(
  "delete-document",
  "Maintain a clean, accurate knowledge base by removing outdated or irrelevant documents when necessary. This powerful management tool helps ensure your users always receive the most current and appropriate information. Use it to eliminate duplicate content, remove superseded information, or manage content lifecycle as part of your knowledge management strategy.",
  {
    documentId: z.string().describe("ID of the document to delete"),
  },
  async ({ documentId }) => {
    // Make API request
    const response = await makeMorphikRequest<any>({
      url: `/documents/${documentId}`,
      method: "DELETE",
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