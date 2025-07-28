import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";
import FormData from "form-data";
import { Document, MorphikConfig } from "../core/types.js";
import { validatePath } from "../core/security.js";
import { searchFiles, getFileStats } from "../core/file-operations.js";
import { makeDirectRequest } from "../core/api-client.js";
import { getMimeType } from "../core/helpers.js";

export function registerFileTools(server: McpServer, config: MorphikConfig) {
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
            text: `Allowed directories for file operations:\n${config.allowedDirectories.join('\n')}`,
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
        const validPath = await validatePath(dirPath, config.allowedDirectories);
        
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
        const validPath = await validatePath(searchPath, config.allowedDirectories);
        
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
        const validPath = await validatePath(filePath, config.allowedDirectories);
        
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
        const validPath = await validatePath(filePath, config.allowedDirectories);
        
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
        
        // Add use_colpali if provided
        if (useColpali !== undefined) {
          formData.append('use_colpali', useColpali.toString());
        }
        
        const url = `/ingest/file`;
        
        // Make direct request
        const response = await makeDirectRequest<Document>(url, formData, config);
        
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
        if (useColpali !== undefined) payloadSummary += ", use_colpali";
        
        const url = `/ingest/file`;
        
        const errorDetails = [
          `Error ingesting file: ${errorMessage}`,
          `File Path: ${filePath}`,
          `Target URL: ${config.apiBase}${url}`,
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

  // 12. Ingest File From Base64
  server.tool(
    "ingest-file-from-base64",
    "Add a file to Morphik's knowledge base by providing base64-encoded file content. This is useful in HTTP/HTTPS transport mode where clients may not have direct file system access. The tool decodes the base64 data and uploads it to Morphik.",
    {
      filename: z.string().describe("The filename including extension (e.g., 'document.pdf', 'image.png')"),
      base64Content: z.string().describe("Base64-encoded file content"),
      metadata: z.record(z.any()).optional().describe("Optional metadata to associate with the file"),
      rules: z.array(z.any()).optional().describe("Optional processing rules"),
      folderName: z.string().optional().describe("Optional folder to organize the document"),
      endUserId: z.string().optional().describe("Optional end user ID for scoping"),
      useColpali: z.boolean().optional().describe("Whether to use the colpali embedding model"),
    },
    async ({ filename, base64Content, metadata, rules, folderName, endUserId, useColpali }) => {
      try {
        // Decode base64 content to buffer
        const buffer = Buffer.from(base64Content, 'base64');
        
        // Create a form data object
        const formData = new FormData();
        
        // Add the file buffer
        formData.append('file', buffer, {
          filename: filename,
          contentType: getMimeType(filename)
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
        
        // Add use_colpali if provided
        if (useColpali !== undefined) {
          formData.append('use_colpali', useColpali.toString());
        }
        
        const url = `/ingest/file`;
        
        // Make direct request
        const response = await makeDirectRequest<Document>(url, formData, config);
        
        return {
          content: [
            {
              type: "text",
              text: `Successfully ingested file "${filename}" from base64 with document ID: ${response.external_id}`,
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
        if (useColpali !== undefined) payloadSummary += ", use_colpali";
        
        const url = `/ingest/file`;
        
        const errorDetails = [
          `Error ingesting file from base64: ${errorMessage}`,
          `Filename: ${filename}`,
          `Base64 content length: ${base64Content.length} characters`,
          `Target URL: ${config.apiBase}${url}`,
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

  // 13. Batch Ingest Files
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
            const validPath = await validatePath(filePath, config.allowedDirectories);
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
        
        // Add use_colpali if provided
        if (useColpali !== undefined) {
          formData.append('use_colpali', useColpali.toString());
        }
        
        const url = `/ingest/files`;
        
        // Use our direct request method instead of makeMorphikRequest
        const response = await makeDirectRequest<any>(url, formData, config);
        
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
        if (useColpali !== undefined) payloadSummary += ", use_colpali";
        
        const url = `/ingest/files`;
        
        const errorDetails = [
          `Error ingesting files: ${errorMessage}`,
          `File Paths: ${paths.join(', ')}`,
          `Target URL: ${config.apiBase}${url}`,
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
}