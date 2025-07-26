import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { 
  Document, 
  DocumentResult, 
  ChunkResult, 
  IngestTextRequest, 
  RetrieveRequest,
  ListDocumentsRequest,
  MorphikConfig 
} from "../core/types.js";
import { makeMorphikRequest } from "../core/api-client.js";
import { processDocumentResponse } from "../core/helpers.js";
import { resizeImageIfNeeded } from "../core/image-processing.js";

export function registerMorphikTools(server: McpServer, config: MorphikConfig) {
  // 1. Ingest Text Document
  server.tool(
    "ingest-text",
    "Unlock knowledge retrieval by seamlessly adding text content to Morphik's powerful knowledge base. This essential first step ensures your valuable information becomes instantly searchable, helping users find exactly what they need. Perfect for documentation, research findings, support articles, or any text that needs to be discoverable.",
    {
      content: z.string().describe("Text content to ingest"),
      filename: z.string().optional().describe("Optional filename to help determine content type"),
      metadata: z.record(z.any()).optional().describe("Optional metadata dictionary"),
      rules: z.array(z.record(z.any())).optional().describe("Optional list of extraction/NL rules"),
      useColpali: z.boolean().optional().describe("Whether to use ColPali-style embedding model"),
      folderName: z.string().optional().describe("Optional folder scope for the operation"),
      endUserId: z.string().optional().describe("Optional end-user scope for the operation"),
    },
    async ({ content, filename, metadata, rules, useColpali, folderName, endUserId }) => {
      // Prepare request body
      const requestBody: IngestTextRequest = {
        content,
        filename,
        metadata: metadata || {},
        rules: rules || [],
        use_colpali: useColpali,
        folder_name: folderName,
        end_user_id: endUserId,
      };

      // Make API request
      const response = await makeMorphikRequest<Document>({
        url: "/ingest/text",
        method: "POST",
        body: requestBody,
        config,
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
      useReranking: z.boolean().optional().describe("Whether to use reranking"),
      useColpali: z.boolean().optional().describe("Whether to use ColPali-style embedding model"),
      padding: z.number().optional().describe("Number of additional chunks/pages to retrieve before and after matched chunks (ColPali only)"),
      graphName: z.string().optional().describe("Name of the graph to use for knowledge graph-enhanced retrieval"),
      hopDepth: z.number().optional().describe("Number of relationship hops to traverse in the graph (1-3)"),
      includePaths: z.boolean().optional().describe("Whether to include relationship paths in the response"),
      folderName: z.union([z.string(), z.array(z.string())]).optional().describe("Optional folder scope (single folder name or array of folder names)"),
      endUserId: z.string().optional().describe("Optional end-user scope for the operation"),
    },
    async ({ query, filters, k, minScore, useReranking, useColpali, padding, graphName, hopDepth, includePaths, folderName, endUserId }) => {
      // Prepare request body
      const requestBody: RetrieveRequest = {
        query,
        filters: filters || {},
        k: k || 4,
        min_score: minScore || 0,
        use_reranking: useReranking,
        use_colpali: useColpali !== undefined ? useColpali : true, // Enable colpali by default
        padding: padding || 0,
        graph_name: graphName,
        hop_depth: hopDepth || 1,
        include_paths: includePaths || false,
        folder_name: folderName,
        end_user_id: endUserId,
      };

      // Make API request
      const response = await makeMorphikRequest<ChunkResult[]>({
        url: "/retrieve/chunks",
        method: "POST",
        body: requestBody,
        config,
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

  // 2a. Document Retrieval (Grouped Chunks)
  server.tool(
    "retrieve-chunks-grouped",
    "Retrieve chunks with grouped response format, particularly useful when using padding to get context around matching chunks. This endpoint returns both flat results (for backward compatibility) and grouped results organized by main matches and their padding chunks, making it ideal for UI display and understanding context relationships.",
    {
      query: z.string().describe("The search query"),
      filters: z.record(z.any()).optional().describe("Optional metadata filters"),
      k: z.number().optional().describe("Number of results to return (default: 4)"),
      minScore: z.number().optional().describe("Minimum relevance score (default: 0)"),
      useReranking: z.boolean().optional().describe("Whether to use reranking"),
      useColpali: z.boolean().optional().describe("Whether to use ColPali-style embedding model"),
      padding: z.number().optional().describe("Number of additional chunks/pages to retrieve before and after matched chunks (ColPali only)"),
      graphName: z.string().optional().describe("Name of the graph to use for knowledge graph-enhanced retrieval"),
      hopDepth: z.number().optional().describe("Number of relationship hops to traverse in the graph (1-3)"),
      includePaths: z.boolean().optional().describe("Whether to include relationship paths in the response"),
      folderName: z.union([z.string(), z.array(z.string())]).optional().describe("Optional folder scope (single folder name or array of folder names)"),
      endUserId: z.string().optional().describe("Optional end-user scope for the operation"),
    },
    async ({ query, filters, k, minScore, useReranking, useColpali, padding, graphName, hopDepth, includePaths, folderName, endUserId }) => {
      // Prepare request body
      const requestBody: RetrieveRequest = {
        query,
        filters: filters || {},
        k: k || 4,
        min_score: minScore || 0,
        use_reranking: useReranking,
        use_colpali: useColpali !== undefined ? useColpali : true, // Enable colpali by default
        padding: padding || 0,
        graph_name: graphName,
        hop_depth: hopDepth || 1,
        include_paths: includePaths || false,
        folder_name: folderName,
        end_user_id: endUserId,
      };

      // Make API request
      const response = await makeMorphikRequest<any>({
        url: "/retrieve/chunks/grouped",
        method: "POST",
        body: requestBody,
        config,
      });

      if (!response || !response.chunks || response.chunks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No relevant chunks found for the query",
            },
          ],
        };
      }

      // Process both flat and grouped results
      const flatChunks = response.chunks || [];
      const groupedChunks = response.grouped_chunks || [];

      let resultText = `Retrieved ${flatChunks.length} chunks`;
      if (groupedChunks.length > 0) {
        resultText += ` in ${groupedChunks.length} groups`;
      }
      resultText += ":\n\n";

      // Show grouped results if available
      if (groupedChunks.length > 0) {
        for (const group of groupedChunks) {
          resultText += `**Main Match (Score: ${group.main_chunk.score.toFixed(2)})**\n`;
          resultText += `${group.main_chunk.content}\n`;
          resultText += `(Document: ${group.main_chunk.document_id}, Chunk: ${group.main_chunk.chunk_number})\n`;
          
          if (group.padding_chunks && group.padding_chunks.length > 0) {
            resultText += `\n*Context chunks (${group.padding_chunks.length}):*\n`;
            for (const padChunk of group.padding_chunks) {
              resultText += `- ${padChunk.content.substring(0, 100)}...\n`;
              resultText += `  (Document: ${padChunk.document_id}, Chunk: ${padChunk.chunk_number})\n`;
            }
          }
          resultText += "\n---\n\n";
        }
      } else {
        // Fallback to flat results
        for (const chunk of flatChunks) {
          resultText += `[Score: ${chunk.score.toFixed(2)}] ${chunk.content}\n`;
          resultText += `(Document: ${chunk.document_id}, Chunk: ${chunk.chunk_number})\n\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
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
      useReranking: z.boolean().optional().describe("Whether to use reranking"),
      useColpali: z.boolean().optional().describe("Whether to use ColPali-style embedding model"),
      padding: z.number().optional().describe("Number of additional chunks/pages to retrieve before and after matched chunks (ColPali only)"),
      graphName: z.string().optional().describe("Name of the graph to use for knowledge graph-enhanced retrieval"),
      hopDepth: z.number().optional().describe("Number of relationship hops to traverse in the graph (1-3)"),
      includePaths: z.boolean().optional().describe("Whether to include relationship paths in the response"),
      folderName: z.union([z.string(), z.array(z.string())]).optional().describe("Optional folder scope (single folder name or array of folder names)"),
      endUserId: z.string().optional().describe("Optional end-user scope for the operation"),
    },
    async ({ query, filters, k, minScore, useReranking, useColpali, padding, graphName, hopDepth, includePaths, folderName, endUserId }) => {
      // Prepare request body
      const requestBody: RetrieveRequest = {
        query,
        filters: filters || {},
        k: k || 4,
        min_score: minScore || 0,
        use_reranking: useReranking,
        use_colpali: useColpali !== undefined ? useColpali : true, // Enable colpali by default
        padding: padding || 0,
        graph_name: graphName,
        hop_depth: hopDepth || 1,
        include_paths: includePaths || false,
        folder_name: folderName,
        end_user_id: endUserId,
      };

      // Make API request
      const response = await makeMorphikRequest<DocumentResult[]>({
        url: "/retrieve/docs",
        method: "POST",
        body: requestBody,
        config,
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
        // Check for image documents using multiple detection methods
        const isImage = (doc.metadata && doc.metadata.is_image === true) ||
                       (doc.content.value && doc.content.value.startsWith('data:image/')) ||
                       (doc.content.value && doc.content.value.length > 50000 && /^[A-Za-z0-9+/=]+$/.test(doc.content.value.trim()));
        
        if (isImage) {
          let imageData = doc.content.value;
          if (imageData.startsWith('data:')) {
            imageData = imageData.split(',')[1] || imageData;
          }
          
          try {
            // Resize the image if needed to stay under Claude's size limit
            const resizedImage = await resizeImageIfNeeded(imageData);
            
            return {
              type: "image" as const,
              data: resizedImage.data,
              mimeType: resizedImage.mimeType // Use the correct MIME type
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
      folderName: z.union([z.string(), z.array(z.string())]).optional().describe("Optional folder scope (single folder name or array of folder names)"),
      endUserId: z.string().optional().describe("Optional end-user scope for the operation"),
    },
    async ({ skip, limit, filters, folderName, endUserId }) => {
      // Prepare URL with query parameters  
      const params = new URLSearchParams();
      if (folderName) {
        if (Array.isArray(folderName)) {
          folderName.forEach(fn => params.append("folder_name", fn));
        } else {
          params.append("folder_name", folderName);
        }
      }
      if (endUserId) params.append("end_user_id", endUserId);

      const url = `/documents?${params.toString()}`;
      
      // Prepare request body
      const requestBody = {
        document_filters: filters || {},
        skip: skip || 0,
        limit: limit || 10,
      };

      // Make API request
      const response = await makeMorphikRequest<Document[]>({
        url,
        method: "POST",
        body: requestBody,
        config,
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
        method: "GET",
        config,
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
        config,
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
}