#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createReadStream } from "fs";
import FormData from "form-data";
import { minimatch } from "minimatch";
import fetch from "node-fetch";
import type { RequestInit } from "node-fetch";

// Parse command line arguments
const args = process.argv.slice(2);
let morphikApiBase = "http://localhost:8000"; // Default Base URL for Morphik API
let authToken = ""; // Bearer token for authentication
let uriProvided = false;

// Parse URI format or URI argument
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--uri=')) {
    uriProvided = true;
    const uriValue = arg.substring(6);
    
    // Handle local case
    if (uriValue === 'local' || uriValue === '') {
      // Use default localhost URL
      morphikApiBase = "http://localhost:8000";
    }
    // Check if it's a morphik URI format: morphik://<owner_id>:<token>@<host>
    else if (uriValue.startsWith('morphik://')) {
      try {
        // Parse the morphik URI format
        const uriWithoutProtocol = uriValue.replace('morphik://', '');
        const [authPart, hostPart] = uriWithoutProtocol.split('@');
        
        if (authPart && hostPart) {
          // Extract token from auth part (format: owner_id:token)
          const [, token] = authPart.split(':');
          
          if (token) {
            authToken = token;
            // Always use HTTPS for Morphik API with authentication
            morphikApiBase = `https://${hostPart}`;
            // console.log("api is morphikApiBase: ", morphikApiBase);
          }
        }
      } catch (error) {
        console.error("Error parsing morphik URI:", error);
        // Fall back to using the URI value directly
        morphikApiBase = uriValue;
      }
    } else {
      // Not a morphik URI, use as is
      morphikApiBase = uriValue;
    }
  }
}

// If no URI was provided, use localhost
if (!uriProvided) {
  morphikApiBase = "http://localhost:8000";
}

const MORPHIK_API_BASE = morphikApiBase;
const AUTH_TOKEN = authToken;
const USER_AGENT = "morphik-mcp/1.0";

// Log connection info with clear indication of mode
if (MORPHIK_API_BASE === "http://localhost:8000") {
  console.error(`Connecting to Morphik API in local mode: ${MORPHIK_API_BASE}`);
} else {
  console.error(`Connecting to Morphik API at: ${MORPHIK_API_BASE}`);
}

// Log authentication status
if (AUTH_TOKEN) {
  console.error('Authentication: Using bearer token from URI');
} else {
  console.error('Authentication: None (development mode)');
}

// Filesystem access configuration
// Parse allowed directories from command line (--allowed-dir=path1,path2,...)
let allowedDirectories: string[] = [];

// Find allowed directories argument
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--allowed-dir=')) {
    let dirValue = arg.substring(13); // Get value after --allowed-dir=
    if (dirValue) {
      // Split by comma
      allowedDirectories = dirValue.split(',').map(dir => {
        // Trim whitespace and potential leading '='
        let cleanDir = dir.trim();
        if (cleanDir.startsWith('=')) {
          cleanDir = cleanDir.substring(1);
        }
        // Expand home dir and normalize
        return normalizePath(expandHome(cleanDir));
      });
    }
  }
}

// If no allowed directories were specified, use home directory as default
if (allowedDirectories.length === 0) {
  allowedDirectories = [normalizePath(os.homedir())];
  console.error('No allowed directories specified, defaulting to home directory');
}

console.error('Allowed directories for file operations:', allowedDirectories);

// Path normalization utilities
function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function normalizePath(p: string): string {
  return path.normalize(p);
}

// Security validation for file paths
async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
  if (!isAllowed) {
    throw new Error(`Access denied - path outside allowed directories: ${absolute}`);
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
    if (!isRealPathAllowed) {
      throw new Error("Access denied - symlink target outside allowed directories");
    }
    return realPath;
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute);
    try {
      const realParentPath = await fs.realpath(parentDir);
      const normalizedParent = normalizePath(realParentPath);
      const isParentAllowed = allowedDirectories.some(dir => normalizedParent.startsWith(dir));
      if (!isParentAllowed) {
        throw new Error("Access denied - parent directory outside allowed directories");
      }
      return absolute;
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  }
}

// File search helper function
async function searchFiles(
  rootPath: string,
  pattern: string,
  excludePatterns: string[] = []
): Promise<string[]> {
  const results: string[] = [];

  async function search(currentPath: string) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        try {
          // Check if path matches any exclude pattern
          const relativePath = path.relative(rootPath, fullPath);
          const shouldExclude = excludePatterns.some(pattern => {
            const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`;
            return minimatch(relativePath, globPattern, { dot: true });
          });

          if (shouldExclude) {
            continue;
          }

          if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
            results.push(fullPath);
          }

          if (entry.isDirectory()) {
            await search(fullPath);
          }
        } catch (error) {
          // Skip invalid paths during search
          continue;
        }
      }
    } catch (error) {
      // Skip directories we can't read
      console.error(`Error searching directory ${currentPath}:`, error);
    }
  }

  await search(rootPath);
  return results;
}

// Get file stats helper function
async function getFileStats(filePath: string): Promise<Record<string, any>> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

// Maximum image size for Claude (in bytes) - slightly under 1MB to be safe
const MAX_IMAGE_SIZE = 900 * 1024; // 900KB

/**
 * Resizes an image to ensure it's under the maximum size limit for Claude
 * @param imageData Base64-encoded image data
 * @returns Resized base64-encoded image data
 */
async function resizeImageIfNeeded(imageData: string): Promise<string> {
  // Convert base64 to buffer
  const buffer = Buffer.from(imageData, 'base64');
  
  // If image is already under the size limit, return it as is
  if (buffer.length <= MAX_IMAGE_SIZE) {
    return imageData;
  }
  
  // Calculate resize factor based on current size
  const sizeFactor = Math.sqrt(MAX_IMAGE_SIZE / buffer.length);
  
  try {
    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    
    // Calculate new dimensions, keeping aspect ratio
    const newWidth = Math.floor((metadata.width || 800) * sizeFactor);
    const newHeight = Math.floor((metadata.height || 600) * sizeFactor);
    
    console.error(`Resizing image from ${buffer.length} bytes (${metadata.width}x${metadata.height}) to target ${MAX_IMAGE_SIZE} bytes (${newWidth}x${newHeight})`);
    
    // Resize and optimize the image
    const resizedImageBuffer = await sharp(buffer)
      .resize(newWidth, newHeight)
      .webp({ quality: 80 }) // Use webp for better compression
      .toBuffer();
    
    console.error(`Resized image to ${resizedImageBuffer.length} bytes`);
    
    // If still too large, reduce quality further
    if (resizedImageBuffer.length > MAX_IMAGE_SIZE) {
      const qualityFactor = MAX_IMAGE_SIZE / resizedImageBuffer.length * 75; // Reduce quality proportionally
      
      const furtherResizedBuffer = await sharp(buffer)
        .resize(newWidth, newHeight)
        .webp({ quality: Math.floor(qualityFactor) })
        .toBuffer();
        
      console.error(`Further resized image to ${furtherResizedBuffer.length} bytes with quality ${Math.floor(qualityFactor)}`);
      
      return furtherResizedBuffer.toString('base64');
    }
    
    return resizedImageBuffer.toString('base64');
  } catch (error) {
    console.error("Error resizing image:", error);
    // Fall back to original image if resize fails
    return imageData;
  }
}

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
  
  // Add Authorization header if we have a token
  if (AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  }
  
  if (!isMultipart && body !== undefined) {
    headers["Content-Type"] = "application/json";
  } else if (isMultipart && body instanceof FormData) {
    // When using FormData, get the generated headers with boundaries
    Object.assign(headers, body.getHeaders());
  }
  
  try {
    // Prepare request options - using any to bypass type checking issues
    const requestOptions: any = {
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
  content?: string; // Added for document content access
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

// File operation interfaces
interface ListDirectoryResult {
  entries: {
    name: string;
    type: 'file' | 'directory';
    path: string;
  }[];
}

interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

interface SearchFilesResult {
  matches: string[];
}

// Create server instance
const server = new McpServer({
  name: "morphik",
  version: "1.0.0",
  capabilities: {
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
    const contentItemPromises = response.map(async (chunk) => {
      // For images, check if metadata indicates it's an image
      if (chunk.metadata && chunk.metadata.is_image === true) {
        // Extract the base64 data from the data URI (remove the prefix if present)
        let imageData = chunk.content;
        if (imageData.startsWith('data:')) {
          // Remove the prefix (e.g., "data:image/png;base64,")
          imageData = imageData.split(',')[1] || imageData;
        }
        
        try {
          // Resize the image if needed to stay under Claude's size limit
          const resizedImageData = await resizeImageIfNeeded(imageData);
          
          // Create a proper image resource in the format expected by MCP
          return {
            type: "image" as const,
            data: resizedImageData, // Use the possibly resized image data
            mimeType: "image/png" // Images are always PNG or WebP after resize
          };
        } catch (error) {
          console.error("Error processing image data:", error);
          return {
            type: "text" as const,
            text: `[Error: Could not process image from chunk ${chunk.chunk_number} in document ${chunk.document_id}]`
          };
        }
      }
      
      // For text content
      return {
        type: "text" as const,
        text: `[Score: ${chunk.score.toFixed(2)}] ${chunk.content}\n(Document: ${chunk.document_id}, Chunk: ${chunk.chunk_number})`
      };
    });
    
    // Wait for all content items to be processed (images may need to be resized)
    const contentItems = await Promise.all(contentItemPromises);

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
    const contentItemPromises = response.map(async (doc) => {
      // Check for image documents
      if (doc.metadata && doc.metadata.is_image === true) {
        let imageData = doc.content.value;
        if (imageData.startsWith('data:')) {
          imageData = imageData.split(',')[1] || imageData;
        }
        
        try {
          // Resize the image if needed to stay under Claude's size limit
          const resizedImageData = await resizeImageIfNeeded(imageData);
          
          return {
            type: "image" as const,
            data: resizedImageData,
            mimeType: "image/png" // Images are always PNG or WebP after resize
          };
        } catch (error) {
          console.error("Error processing image data:", error);
          return {
            type: "text" as const,
            text: `[Error: Could not process image from document ${doc.document_id}]`
          };
        }
      }
      
      // For text content
      const content = doc.content.type === "url" 
        ? `[URL: ${doc.content.value}]` 
        : doc.content.value.substring(0, 100) + "...";
      
      return {
        type: "text" as const,
        text: `[Score: ${doc.score.toFixed(2)}] ${content}\n(Document ID: ${doc.document_id})`
      };
    });
    
    // Wait for all content items to be processed (images may need to be resized)
    const contentItems = await Promise.all(contentItemPromises);

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

// 7. List Allowed Directories
server.tool(
  "list-allowed-directories",
  "Get a list of directories the MCP server is allowed to access for file operations. Use this to understand where you can browse and select files for ingestion into Morphik.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: `Allowed directories for file operations:\n${allowedDirectories.join('\n')}`,
        },
      ],
    };
  },
);

// 8. List Directory
server.tool(
  "list-directory",
  "List files and subdirectories in a specified directory. Results are marked as either [FILE] or [DIR]. Use this to browse file systems to find files you want to ingest into Morphik.",
  {
    path: z.string().describe("The directory path to list files from"),
  },
  async ({ path: dirPath }) => {
    try {
      // Validate path is within allowed directories
      const validPath = await validatePath(dirPath);
      
      // Verify it's a directory
      const stats = await fs.stat(validPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
      }
      
      // Read directory contents
      const entries = await fs.readdir(validPath, { withFileTypes: true });
      
      // Format entries with type indicators
      const formattedEntries = entries.map(entry => {
        return `${entry.isDirectory() ? "[DIR] " : "[FILE]"} ${entry.name}`;
      }).join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: formattedEntries || "Directory is empty.",
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing directory: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// 9. Search Files
server.tool(
  "search-files",
  "Search for files matching a pattern in a directory and its subdirectories. This is useful for finding files when you don't know their exact location or want to find all files of a certain type.",
  {
    path: z.string().describe("The root directory to search in"),
    pattern: z.string().describe("The search pattern (case-insensitive)"),
    excludePatterns: z.array(z.string()).optional().describe("Patterns to exclude from search results"),
  },
  async ({ path: searchPath, pattern, excludePatterns }) => {
    try {
      // Validate path is within allowed directories
      const validPath = await validatePath(searchPath);
      
      // Verify it's a directory
      const stats = await fs.stat(validPath);
      if (!stats.isDirectory()) {
        throw new Error(`Search path is not a directory: ${searchPath}`);
      }
      
      // Perform the search
      const results = await searchFiles(validPath, pattern, excludePatterns || []);
      
      return {
        content: [
          {
            type: "text",
            text: results.length > 0 
              ? `Found ${results.length} matches:\n${results.join('\n')}` 
              : "No matching files found.",
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error searching files: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// 10. Get File Info
server.tool(
  "get-file-info",
  "Get detailed information about a file or directory, including size, creation time, and permissions. Use this to check if a file exists and learn more about it before ingesting.",
  {
    path: z.string().describe("Path to the file or directory"),
  },
  async ({ path: filePath }) => {
    try {
      // Validate path is within allowed directories
      const validPath = await validatePath(filePath);
      
      // Get file stats
      const stats = await getFileStats(validPath);
      
      // Format the output
      const formattedInfo = Object.entries(stats)
        .map(([key, value]) => `${key}: ${value instanceof Date ? value.toISOString() : value}`)
        .join('\n');
      
      return {
        content: [
          {
            type: "text",
            text: formattedInfo,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error getting file info: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Helper function for determining MIME type
function getMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'csv': 'text/csv',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'json': 'application/json',
    'html': 'text/html',
    'htm': 'text/html',
    'xml': 'application/xml',
    'md': 'text/markdown',
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
    'zip': 'application/zip',
  };
  
  return mimeTypes[extension] || 'application/octet-stream';
}

// Helper function for making direct fetch requests with FormData
async function makeDirectRequest<T>(url: string, formData: FormData): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${MORPHIK_API_BASE}${url}`;
  
  // Set up headers from FormData with proper typing
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    // Spread the FormData headers
    ...(formData.getHeaders() as Record<string, string>)
  };
  
  // Add Authorization header if we have a token
  if (AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  }
  
  // Make the request with bypass type checking via any
  const requestOptions: any = {
    method: "POST",
    headers,
    body: formData
  };
  
  const response = await fetch(fullUrl, requestOptions);
  
  // Check for HTTP errors
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
  }
  
  // Parse and return JSON response
  return await response.json() as T;
}

// 11. Ingest File From Path
server.tool(
  "ingest-file-from-path",
  "Add a file to Morphik's knowledge base by providing its path on the server's file system. This tool handles reading the file and uploading it to Morphik, making it searchable. Supports various file types including PDFs, Word documents, images, and more.",
  {
    path: z.string().describe("Path to the file on the server's file system"),
    metadata: z.record(z.any()).optional().describe("Optional metadata to associate with the file"),
    rules: z.array(z.any()).optional().describe("Optional processing rules"),
    folderName: z.string().optional().describe("Optional folder to organize the document"),
    endUserId: z.string().optional().describe("Optional end user ID for scoping"),
    useColpali: z.boolean().optional().describe("Whether to use the colpali embedding model"),
  },
  async ({ path: filePath, metadata, rules, folderName, endUserId, useColpali }) => {
    try {
      // Validate path is within allowed directories
      const validPath = await validatePath(filePath);
      
      // Verify it's a file
      const stats = await fs.stat(validPath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }
      
      // Create a form data object
      const formData = new FormData();
      
      // Add the file stream
      formData.append('file', createReadStream(validPath), {
        filename: path.basename(validPath),
        contentType: getMimeType(path.basename(validPath))
      });
      
      // Add metadata (required, default "{}")
      formData.append('metadata', metadata ? JSON.stringify(metadata) : "{}");
      
      // Add rules (required, default "[]")
      formData.append('rules', rules ? JSON.stringify(rules) : "[]");
      
      // Add folder name if provided
      if (folderName) {
        formData.append('folder_name', folderName);
      }
      
      if (endUserId) {
        formData.append('end_user_id', endUserId);
      }
      
      // Prepare URL with query parameters
      const params = new URLSearchParams();
      if (useColpali !== undefined) {
        params.append('use_colpali', useColpali.toString());
      }
      
      const url = `/ingest/file${params.toString() ? `?${params.toString()}` : ''}`;
      
      // Make direct request
      const response = await makeDirectRequest<Document>(url, formData);
      
      return {
        content: [
          {
            type: "text",
            text: `Successfully ingested file "${path.basename(validPath)}" with document ID: ${response.external_id}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Construct detailed error message
      let payloadSummary = `FormData included keys: file`;
      if (metadata) payloadSummary += ", metadata";
      if (rules) payloadSummary += ", rules";
      if (folderName) payloadSummary += ", folder_name";
      if (endUserId) payloadSummary += ", end_user_id";
      
      const params = new URLSearchParams();
      if (useColpali !== undefined) {
        params.append('use_colpali', useColpali.toString());
      }
      const url = `/ingest/file${params.toString() ? `?${params.toString()}` : ''}`;
      
      const errorDetails = [
        `Error ingesting file: ${errorMessage}`,
        `File Path: ${filePath}`,
        `Target URL: ${MORPHIK_API_BASE}${url}`,
        `Method: POST`,
        `Payload Summary: ${payloadSummary}`,
      ].join('\n');
      
      return {
        content: [{ type: "text", text: errorDetails }],
        isError: true,
      };
    }
  },
);

// 12. Batch Ingest Files
server.tool(
  "ingest-files-from-paths",
  "Add multiple files to Morphik's knowledge base simultaneously by providing their paths on the server's file system. This batch operation is more efficient than ingesting files one by one.",
  {
    paths: z.array(z.string()).describe("Array of file paths to ingest"),
    metadata: z.union([
      z.record(z.any()),
      z.array(z.record(z.any()))
    ]).optional().describe("Single metadata object for all files or an array of metadata objects, one per file"),
    rules: z.union([
      z.array(z.any()),
      z.array(z.array(z.any()))
    ]).optional().describe("Single list of rules for all files or an array of rule lists, one per file"),
    folderName: z.string().optional().describe("Optional folder to organize the documents"),
    endUserId: z.string().optional().describe("Optional end user ID for scoping"),
    useColpali: z.boolean().optional().describe("Whether to use the colpali embedding model"),
  },
  async ({ paths, metadata, rules, folderName, endUserId, useColpali }) => {
    try {
      // Validate all paths are within allowed directories and are files
      const validPaths = await Promise.all(
        paths.map(async (filePath) => {
          const validPath = await validatePath(filePath);
          const stats = await fs.stat(validPath);
          
          if (!stats.isFile()) {
            throw new Error(`Path is not a file: ${filePath}`);
          }
          
          return validPath;
        })
      );
      
      // Create a form data object
      const formData = new FormData();
      
      // Add all the files
      for (let i = 0; i < validPaths.length; i++) {
        formData.append('files', createReadStream(validPaths[i]), path.basename(validPaths[i]));
      }
      
      // Add metadata (required, default "{}" if single, or handle array case)
      // Note: The API expects a single stringified JSON for metadata/rules in batch mode.
      // If metadata/rules are arrays, they should correspond to the files array.
      formData.append('metadata', metadata ? JSON.stringify(metadata) : "{}");
      
      // Add rules (required, default "[]")
      formData.append('rules', rules ? JSON.stringify(rules) : "[]");
      
      if (folderName) {
        formData.append('folder_name', folderName);
      }
      
      if (endUserId) {
        formData.append('end_user_id', endUserId);
      }
      
      // Prepare URL with query parameters if needed
      const params = new URLSearchParams();
      if (useColpali !== undefined) {
        params.append('use_colpali', useColpali.toString());
      }
      
      const url = `/ingest/files${params.toString() ? `?${params.toString()}` : ''}`;
      
      // Use our direct request method instead of makeMorphikRequest
      const response = await makeDirectRequest<any>(url, formData);
      
      if (!response) {
        throw new Error('Failed to ingest files');
      }
      
      // Format the response based on batch results
      let resultText = "";
      
      if (response.documents && response.documents.length > 0) {
        const fileNames = validPaths.map(p => path.basename(p));
        resultText += `Successfully ingested ${response.documents.length} files:\n`;
        response.documents.forEach((doc: any, index: number) => {
          resultText += `- ${fileNames[index] || `File ${index + 1}`}: Document ID ${doc.external_id}\n`;
        });
      }
      
      if (response.errors && response.errors.length > 0) {
        resultText += `\nFailed to ingest ${response.errors.length} files:\n`;
        response.errors.forEach((error: any, index: number) => {
          resultText += `- ${error.filename || `File ${index + 1}`}: ${error.message || 'Unknown error'}\n`;
        });
      }
      
      return {
        content: [
          {
            type: "text",
            text: resultText || "File ingestion completed, but no status information was returned.",
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Construct detailed error message
      let payloadSummary = `FormData included keys: files (count: ${paths.length})`;
      if (metadata) payloadSummary += ", metadata";
      if (rules) payloadSummary += ", rules";
      if (folderName) payloadSummary += ", folder_name";
      if (endUserId) payloadSummary += ", end_user_id";
      
      const params = new URLSearchParams();
      if (useColpali !== undefined) {
        params.append('use_colpali', useColpali.toString());
      }
      const url = `/ingest/files${params.toString() ? `?${params.toString()}` : ''}`;
      
      const errorDetails = [
        `Error ingesting files: ${errorMessage}`,
        `File Paths: ${paths.join(', ')}`,
        `Target URL: ${MORPHIK_API_BASE}${url}`,
        `Method: POST`,
        `Payload Summary: ${payloadSummary}`,
      ].join('\n');
      
      return {
        content: [{ type: "text", text: errorDetails }],
        isError: true,
      };
    }
  },
);

// NOTE: Resource template code removed to prevent continuous /documents requests
// Images are already handled directly in the retrieve-chunks and retrieve-docs tools

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Morphik MCP Server running on stdio");
  console.error(`File operations enabled: ${allowedDirectories.length} allowed ${allowedDirectories.length === 1 ? 'directory' : 'directories'}`);
  console.error(`Use --allowed-dir=dir1,dir2,... to specify allowed directories for file operations`);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
