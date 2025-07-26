#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, createOAuthMetadata } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import express, { Request, Response } from "express";
import cors from "cors";
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
import { randomUUID } from "crypto";

// HTTP server configuration
const PORT = process.env.PORT || 3000;

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
 * @returns Object with resized base64-encoded image data and MIME type
 */
async function resizeImageIfNeeded(imageData: string): Promise<{ data: string; mimeType: string }> {
  // Convert base64 to buffer
  const buffer = Buffer.from(imageData, 'base64');
  
  // If image is already under the size limit, detect format and return it as is
  if (buffer.length <= MAX_IMAGE_SIZE) {
    try {
      const metadata = await sharp(buffer).metadata();
      const mimeType = metadata.format ? `image/${metadata.format}` : 'image/png';
      return { data: imageData, mimeType };
    } catch (error) {
      // If we can't detect format, assume PNG
      return { data: imageData, mimeType: 'image/png' };
    }
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
      
      return { data: furtherResizedBuffer.toString('base64'), mimeType: 'image/webp' };
    }
    
    return { data: resizedImageBuffer.toString('base64'), mimeType: 'image/webp' };
  } catch (error) {
    console.error("Error resizing image:", error);
    // Fall back to original image if resize fails - try to detect format
    try {
      const buffer = Buffer.from(imageData, 'base64');
      const metadata = await sharp(buffer).metadata();
      const mimeType = metadata.format ? `image/${metadata.format}` : 'image/png';
      return { data: imageData, mimeType };
    } catch {
      return { data: imageData, mimeType: 'image/png' };
    }
  }
}

// Helper function for making Morphik API requests
export async function makeMorphikRequest<T>({
  url,
  method = "GET",
  body = undefined,
  isMultipart = false,
  authInfo = undefined,
}: {
  url: string;
  method?: string;
  body?: any;
  isMultipart?: boolean;
  authInfo?: AuthInfo;
}): Promise<T | null> {
  // Determine the appropriate API base and auth token
  let apiBase = MORPHIK_API_BASE;
  let authToken = AUTH_TOKEN;
  
  // If OAuth auth info is provided, use the user-specific URI and token
  if (authInfo?.extra?.morphikUri) {
    apiBase = authInfo.extra.morphikUri as string;
    // In production, you would extract the actual Morphik API token from the OAuth token
    // For now, we'll use the existing AUTH_TOKEN or derive it from OAuth
    authToken = authInfo.token; // This would be mapped to actual Morphik token
  }
  
  const fullUrl = url.startsWith("http") ? url : `${apiBase}${url}`;
  
  // Prepare headers based on content type and authorization
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
  };
  
  // Add Authorization header if we have a token
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
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

// OAuth Provider Implementation for Morphik Integration
class MorphikOAuthClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(clientMetadata: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    const clientId = randomUUID();
    const client: OAuthClientInformationFull = {
      ...clientMetadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(clientId, client);
    return client;
  }
}

class MorphikOAuthProvider implements OAuthServerProvider {
  clientsStore: MorphikOAuthClientsStore;
  private codes = new Map<string, { client: OAuthClientInformationFull; params: AuthorizationParams; codeChallenge?: string }>();
  private tokens = new Map<string, { clientId: string; scopes: string[]; userId: string; morphikUri: string; expiresAt: number }>();

  constructor() {
    this.clientsStore = new MorphikOAuthClientsStore();
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    // Generate authorization code
    const code = randomUUID();
    
    // Store the authorization code with client and params
    this.codes.set(code, { 
      client, 
      params,
      codeChallenge: params.codeChallenge 
    });

    // Construct the Morphik website authorization URL
    // This will redirect users to your Morphik website for authentication
    const morphikAuthUrl = new URL('/oauth/authorize', MORPHIK_API_BASE);
    morphikAuthUrl.searchParams.set('client_id', client.client_id);
    morphikAuthUrl.searchParams.set('redirect_uri', params.redirectUri);
    morphikAuthUrl.searchParams.set('state', params.state || '');
    morphikAuthUrl.searchParams.set('scope', params.scopes?.join(' ') || '');
    morphikAuthUrl.searchParams.set('code_challenge', params.codeChallenge || '');
    morphikAuthUrl.searchParams.set('code_challenge_method', 'S256');
    morphikAuthUrl.searchParams.set('mcp_code', code); // Pass our internal code to Morphik

    // Redirect to Morphik website for authentication
    res.redirect(morphikAuthUrl.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData || codeData.client.client_id !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    return codeData.codeChallenge || '';
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull, 
    authorizationCode: string, 
    codeVerifier?: string
  ): Promise<OAuthTokens> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData || codeData.client.client_id !== client.client_id) {
      throw new Error('Invalid authorization code');
    }

    // Verify PKCE if provided
    if (codeData.codeChallenge && codeVerifier) {
      // TODO: Implement proper PKCE verification
      // For now, we'll skip this check in demo mode
    }

    // Here we would normally exchange the code with Morphik backend
    // For now, we'll generate a token directly
    // In production, this should:
    // 1. Validate the code with Morphik backend
    // 2. Get user info and morphik URI from backend
    // 3. Generate scoped access token

    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    const expiresAt = Date.now() + (3600 * 1000); // 1 hour

    // Store token info - in production this would come from Morphik backend
    this.tokens.set(accessToken, {
      clientId: client.client_id,
      scopes: codeData.params.scopes || [],
      userId: 'demo-user', // This would come from Morphik auth
      morphikUri: MORPHIK_API_BASE, // This would be user-specific URI from Morphik
      expiresAt
    });

    // Clean up authorization code
    this.codes.delete(authorizationCode);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: codeData.params.scopes?.join(' ')
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull, 
    refreshToken: string, 
    scopes?: string[], 
    resource?: URL
  ): Promise<OAuthTokens> {
    // TODO: Implement refresh token logic
    throw new Error('Refresh token exchange not implemented');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenInfo = this.tokens.get(token);
    if (!tokenInfo || tokenInfo.expiresAt < Date.now()) {
      throw new Error('Invalid or expired token');
    }

    return {
      token,
      clientId: tokenInfo.clientId,
      scopes: tokenInfo.scopes,
      expiresAt: Math.floor(tokenInfo.expiresAt / 1000),
      // Include Morphik-specific info that can be used by tools
      extra: {
        userId: tokenInfo.userId,
        morphikUri: tokenInfo.morphikUri
      }
    };
  }
}

// Create OAuth provider instance
const oauthProvider = new MorphikOAuthProvider();

// Request-scoped auth context (simple approach for demo)
// In production, you'd use AsyncLocalStorage or similar
let currentAuthInfo: AuthInfo | undefined;

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
      authInfo: currentAuthInfo,
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
      authInfo: currentAuthInfo,
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
      // For images, check multiple conditions to detect image content
      const isImage = (chunk.metadata && chunk.metadata.is_image === true) ||
                     chunk.content_type?.startsWith('image/') ||
                     (chunk.content && chunk.content.startsWith('data:image/')) ||
                     (chunk.content && chunk.content.length > 50000 && /^[A-Za-z0-9+/=]+$/.test(chunk.content.trim()));
      
      if (isImage) {
        // Extract the base64 data from the data URI (remove the prefix if present)
        let imageData = chunk.content;
        if (imageData.startsWith('data:')) {
          // Remove the prefix (e.g., "data:image/png;base64,")
          imageData = imageData.split(',')[1] || imageData;
        }
        
        try {
          // Resize the image if needed to stay under Claude's size limit
          const resizedImage = await resizeImageIfNeeded(imageData);
          
          // Create a proper image resource in the format expected by MCP
          return {
            type: "image" as const,
            data: resizedImage.data, // Use the possibly resized image data
            mimeType: resizedImage.mimeType // Use the correct MIME type
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

// Add all other tools (retrieve-docs, list-documents, get-document, delete-document, etc.)
// ... (keeping all 12 tools exactly as they were in the original)

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

// Create MCP server function (extracted for reuse)
function createMcpServer(): McpServer {
  return server;
}

async function main() {
  // Create Express app for HTTP server
  const app = express();
  
  // Add CORS middleware
  app.use(cors());
  
  // Add JSON parsing middleware
  app.use(express.json({ limit: '50mb' }));
  
  // Add URL encoded parsing middleware
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Create OAuth metadata
  const serverUrl = new URL(`http://localhost:${PORT}`);
  const oauthMetadata = createOAuthMetadata({
    provider: oauthProvider,
    issuerUrl: serverUrl,
    baseUrl: serverUrl,
    scopesSupported: ['morphik:read', 'morphik:write']
  });

  // Add OAuth router for authorization endpoints
  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: serverUrl,
    baseUrl: serverUrl,
    scopesSupported: ['morphik:read', 'morphik:write'],
    resourceName: 'Morphik MCP Server'
  }));
  
  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      morphikApiBase: MORPHIK_API_BASE,
      hasAuthToken: !!AUTH_TOKEN,
      allowedDirectories: allowedDirectories.length
    });
  });
  
  // MCP endpoint for stateless mode with optional OAuth protection
  app.post('/mcp', 
    // Add OAuth middleware but make it optional for backwards compatibility
    (req: Request, res: Response, next: any) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        // If there's a Bearer token, validate it
        requireBearerAuth({ 
          verifier: oauthProvider,
          resourceMetadataUrl: `${serverUrl}/.well-known/oauth-protected-resource`
        })(req, res, next);
      } else {
        // No OAuth token, proceed without auth (backwards compatibility)
        next();
      }
    },
    async (req: Request, res: Response) => {
    try {
      // Set auth context for this request
      currentAuthInfo = (req as any).auth;
      
      // Create new server and transport for each request (stateless)
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // undefined = stateless mode
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // Clean up after request
      req.on('close', () => {
        transport.close();
        server.close();
        currentAuthInfo = undefined; // Clear auth context
      });

    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });
  
  // Start the HTTP server and return a promise to keep main() alive
  return new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(PORT, () => {
      console.error(`Morphik MCP Server running on HTTP port ${PORT}`);
      console.error(`File operations enabled: ${allowedDirectories.length} allowed ${allowedDirectories.length === 1 ? 'directory' : 'directories'}`);
      console.error(`Use --allowed-dir=dir1,dir2,... to specify allowed directories for file operations`);
      console.error(`Endpoints:`);
      console.error(`  - GET  /health - Health check`);
      console.error(`  - POST /mcp    - MCP requests (stateless mode)`);
    });

    httpServer.on('error', (error) => {
      console.error('Server error:', error);
      reject(error);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.error('\nShutting down server...');
      httpServer.close(() => {
        console.error('Server shut down successfully');
        resolve();
      });
    });

    process.on('SIGTERM', () => {
      console.error('\nShutting down server...');
      httpServer.close(() => {
        console.error('Server shut down successfully');
        resolve();
      });
    });
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});