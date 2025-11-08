import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  Document,
  DocumentResult,
  ChunkResult,
  IngestTextRequest,
  RetrieveRequest,
  ListDocsRequest,
  DocumentPagesResponse,
  MorphikConfig,
} from "../core/types.js";
import { makeMorphikRequest } from "../core/api-client.js";
import { processDocumentResponse } from "../core/helpers.js";
import { resizeImageIfNeeded } from "../core/image-processing.js";

type McpContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type MetadataFilter = Record<string, any>;

const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;
const ALLOWED_FILTER_OPERATORS = new Set(["eq", "regex", "number_range", "date_range"]);

let activeMetadataFilter: MetadataFilter | null = null;

const formatMetadataFilter = (filter: MetadataFilter | null): string =>
  filter ? JSON.stringify(filter, null, 2) : "No metadata filters currently enforced.";

const combineFilters = (userFilters?: MetadataFilter | null): MetadataFilter | undefined => {
  const normalizedUser = userFilters && Object.keys(userFilters).length > 0 ? userFilters : null;
  if (normalizedUser && activeMetadataFilter) {
    return { $and: [normalizedUser, activeMetadataFilter] };
  }
  return normalizedUser ?? activeMetadataFilter ?? undefined;
};

const normalizeFolderParam = (folderName?: string | string[] | null): string | string[] | undefined => {
  if (!folderName) return undefined;
  if (Array.isArray(folderName)) {
    const clean = folderName.map((folder) => folder?.trim()).filter((folder) => folder) as string[];
    return clean.length ? clean : undefined;
  }
  const trimmed = folderName.trim();
  return trimmed ? trimmed : undefined;
};

const looksLikeImage = (chunk: ChunkResult): boolean => {
  if (chunk.metadata && chunk.metadata.is_image === true) return true;
  if (chunk.content_type?.startsWith("image/")) return true;
  if (typeof chunk.content === "string") {
    if (chunk.content.startsWith("data:image/")) return true;
    if (chunk.content.length > 50000 && BASE64_REGEX.test(chunk.content.trim())) return true;
  }
  return false;
};

const stripDataUri = (payload: string): { data: string; mimeType: string } => {
  if (payload.startsWith("data:")) {
    const [, meta] = payload.split("data:");
    if (meta) {
      const [mime, rest] = meta.split(",");
      return {
        data: rest ?? "",
        mimeType: mime?.replace(";base64", "") ?? "image/png",
      };
    }
  }
  return { data: payload, mimeType: "image/png" };
};

const chunkToContent = async (chunk: ChunkResult): Promise<McpContentItem> => {
  if (looksLikeImage(chunk)) {
    let data = chunk.content;
    if (data.startsWith("data:")) {
      data = data.split(",")[1] || data;
    }
    try {
      const resizedImage = await resizeImageIfNeeded(data);
      return { type: "image", data: resizedImage.data, mimeType: resizedImage.mimeType };
    } catch (error) {
      console.error("Error processing chunk image data:", error);
      return {
        type: "text",
        text: `[Error: Could not process image from chunk ${chunk.chunk_number} in document ${chunk.document_id}]`,
      };
    }
  }

  return {
    type: "text",
    text: `[Score: ${chunk.score.toFixed(2)}] ${chunk.content}\n(Document: ${chunk.document_id}, Chunk: ${chunk.chunk_number})`,
  };
};

const parseRulesToFilter = (rules: any[], logic: "and" | "or"): MetadataFilter => {
  const expressions: MetadataFilter[] = [];

  for (const rule of rules) {
    const operator = typeof rule.operator === "string" ? rule.operator : "eq";
    if (!ALLOWED_FILTER_OPERATORS.has(operator)) {
      throw new Error(`Unsupported operator "${operator}". Allowed: ${Array.from(ALLOWED_FILTER_OPERATORS).join(", ")}`);
    }
    if (typeof rule.key !== "string" || !rule.key.trim()) {
      throw new Error("Each rule must include a non-empty `key`.");
    }

    const key = rule.key.trim();
    let expression: MetadataFilter = {};

    switch (operator) {
      case "eq":
        expression = { [key]: rule.value };
        break;
      case "regex":
        if (typeof rule.value !== "string" || !rule.value.trim()) {
          throw new Error("Regex rules require a non-empty string `value`.");
        }
        expression = { [key]: { $regex: rule.value.trim() } };
        break;
      case "number_range": {
        const range: MetadataFilter = {};
        if (typeof rule.min === "number") range.$gte = rule.min;
        if (typeof rule.max === "number") range.$lte = rule.max;
        if (!Object.keys(range).length) {
          throw new Error("number_range requires at least `min` or `max`.");
        }
        expression = { [key]: range };
        break;
      }
      case "date_range": {
        const range: MetadataFilter = {};
        if (rule.from) range.$gte = rule.from;
        if (rule.to) range.$lte = rule.to;
        if (!Object.keys(range).length) {
          throw new Error("date_range requires at least `from` or `to`.");
        }
        expression = { [key]: range };
        break;
      }
      default:
        break;
    }

    expressions.push(expression);
  }

  if (!expressions.length) {
    throw new Error("Rules were provided but no valid filters were generated.");
  }

  if (expressions.length === 1) {
    return expressions[0];
  }

  return logic === "or" ? { $or: expressions } : { $and: expressions };
};

const buildFolderQueryParams = (url: URL, folderName?: string | string[]): void => {
  if (!folderName) return;
  if (Array.isArray(folderName)) {
    folderName.forEach((folder) => {
      if (folder) url.searchParams.append("folder_name", folder);
    });
  } else {
    url.searchParams.append("folder_name", folderName);
  }
};

export function registerMorphikTools(server: McpServer, config: MorphikConfig) {
  // 1. Ingest Text Document
  server.tool(
    "ingest-text",
    "Add raw text into Morphik so it becomes searchable and available for retrieval.",
    {
      content: z.string(),
      filename: z.string().optional(),
      metadata: z.record(z.any()).optional(),
      rules: z.array(z.record(z.any())).optional(),
      useColpali: z.boolean().optional(),
      folderName: z.string().optional(),
      endUserId: z.string().optional(),
    },
    async ({ content, filename, metadata, rules, useColpali, folderName, endUserId }) => {
      const requestBody: IngestTextRequest = {
        content,
        filename,
        metadata: metadata || {},
        rules: rules || [],
        use_colpali: useColpali,
        folder_name: folderName,
        end_user_id: endUserId,
      };

      const response = await makeMorphikRequest<Document>({
        url: "/ingest/text",
        method: "POST",
        body: requestBody,
        config,
      });

      if (!response) {
        return { content: [{ type: "text", text: "Failed to ingest text document" }] };
      }

      return {
        content: [{ type: "text", text: `Successfully ingested document with ID: ${response.external_id}` }],
      };
    },
  );

  // 2. Retrieve Chunks (same behavior as find_relevant_pages in morphik-app)
  server.tool(
    "retrieve-chunks",
    "Retrieve the most relevant text or image pages for a given query. Always call this before answering knowledge-based questions.",
    {
      query: z.string(),
      filters: z.record(z.any()).optional(),
      k: z.number().optional(),
      minScore: z.number().optional(),
      useReranking: z.boolean().optional(),
      useColpali: z.boolean().optional(),
      padding: z.number().optional(),
      graphName: z.string().optional(),
      hopDepth: z.number().optional(),
      includePaths: z.boolean().optional(),
      folderName: z.union([z.string(), z.array(z.string())]).optional(),
      endUserId: z.string().optional(),
    },
    async ({ query, filters, k, minScore, useReranking, useColpali, padding, graphName, hopDepth, includePaths, folderName, endUserId }) => {
      const combinedFilters = combineFilters(filters);
      const requestBody: RetrieveRequest = {
        query,
        filters: combinedFilters ?? {},
        k: k || 2,
        min_score: minScore || 0,
        use_reranking: useReranking,
        use_colpali: useColpali ?? true,
        padding: padding || 0,
        graph_name: graphName,
        hop_depth: hopDepth || 1,
        include_paths: includePaths || false,
        folder_name: normalizeFolderParam(folderName),
        end_user_id: endUserId,
      };

      const response = await makeMorphikRequest<ChunkResult[]>({
        url: "/retrieve/chunks",
        method: "POST",
        body: requestBody,
        config,
      });

      if (!response || response.length === 0) {
        const filterSummary = combinedFilters ? `\nActive filters:\n${JSON.stringify(combinedFilters, null, 2)}` : "";
        return { content: [{ type: "text", text: `No relevant chunks found.${filterSummary}` }] };
      }

      const contentItems = await Promise.all(response.map(chunkToContent));
      contentItems.unshift({ type: "text", text: `Retrieved ${response.length} chunks:` });
      return { content: contentItems };
    },
  );

  // 3. Retrieve Documents
  server.tool(
    "retrieve-docs",
    "Return complete documents that best match a query when you need broader context than individual chunks.",
    {
      query: z.string(),
      filters: z.record(z.any()).optional(),
      k: z.number().optional(),
      minScore: z.number().optional(),
      useReranking: z.boolean().optional(),
      useColpali: z.boolean().optional(),
      folderName: z.union([z.string(), z.array(z.string())]).optional(),
      endUserId: z.string().optional(),
    },
    async ({ query, filters, k, minScore, useReranking, useColpali, folderName, endUserId }) => {
      const combinedFilters = combineFilters(filters);
      const requestBody: RetrieveRequest = {
        query,
        filters: combinedFilters ?? {},
        k: k || 2,
        min_score: minScore || 0,
        use_reranking: useReranking,
        use_colpali: useColpali ?? true,
        folder_name: normalizeFolderParam(folderName),
        end_user_id: endUserId,
      };

      const response = await makeMorphikRequest<DocumentResult[]>({
        url: "/retrieve/docs",
        method: "POST",
        body: requestBody,
        config,
      });

      if (!response || response.length === 0) {
            return { content: [{ type: "text", text: "No relevant documents found for the query" }] };
      }

      const contentItems = await Promise.all(
        response.map(async (doc) => {
          const isImage =
            (doc.metadata && doc.metadata.is_image === true) ||
            (doc.content.value && doc.content.value.startsWith("data:image/")) ||
            (doc.content.value && doc.content.value.length > 50000 && BASE64_REGEX.test(doc.content.value.trim()));

          if (isImage && doc.content.value) {
            let imageData = doc.content.value;
            if (imageData.startsWith("data:")) {
              imageData = imageData.split(",")[1] || imageData;
            }
            try {
              const resizedImage = await resizeImageIfNeeded(imageData);
              return { type: "image" as const, data: resizedImage.data, mimeType: resizedImage.mimeType };
            } catch (error) {
              console.error("Error processing image data:", error);
              return { type: "text" as const, text: `[Error: Could not process image from document ${doc.document_id}]` };
            }
          }

          const content =
            doc.content.type === "url" ? `[URL: ${doc.content.value}]` : `${doc.content.value.substring(0, 100)}...`;
          return { type: "text" as const, text: `[Score: ${doc.score.toFixed(2)}] ${content}\n(Document ID: ${doc.document_id})` };
        }),
      );

      contentItems.unshift({ type: "text", text: `Retrieved ${response.length} documents:` });
      return { content: contentItems };
    },
  );

  // 4. Search Documents by Filename
  server.tool(
    "search-documents",
    "Search for documents by filename or title using full-text search. Use this to discover documents before retrieving their content.",
    {
      query: z.string(),
      limit: z.number().min(1).max(100).optional(),
      folderName: z.union([z.string(), z.array(z.string())]).optional(),
      endUserId: z.string().optional(),
    },
    async ({ query, limit, folderName, endUserId }) => {
      const url = new URL(`${config.apiBase}/documents/search`);
      const normalizedFolder = normalizeFolderParam(folderName);
      if (normalizedFolder) buildFolderQueryParams(url, normalizedFolder);
      if (endUserId) url.searchParams.set("end_user_id", endUserId);

      const requestBody = {
        query,
        limit: limit || 10,
      };

      const response = await makeMorphikRequest<Document[]>({
        url: url.toString(),
        method: "POST",
        body: requestBody,
        config,
      });

      if (!response || response.length === 0) {
        return { content: [{ type: "text", text: `No documents found matching "${query}".` }] };
      }

      const documentList = response
        .map((doc, index) => {
          const filename = doc.filename || doc.external_id || "Untitled";
          const id = doc.external_id || "unknown";
          return `${index + 1}. "${filename}" (ID: ${id})`;
        })
        .join("\n");

      const summary = `Found ${response.length} document${response.length !== 1 ? "s" : ""} matching "${query}":\n\n${documentList}`;
      return { content: [{ type: "text", text: summary }] };
    },
  );

  // 5. Page Range Extraction
  server.tool(
    "get-pages-in-range",
    "Retrieve an inclusive page range (max 10 pages) from a document. Ideal for reading context around earlier chunk hits.",
    {
      documentId: z.string().describe("Document ID to extract pages from"),
      startPage: z.number().describe("First page in the range (1-indexed)"),
      endPage: z.number().describe("Last page in the range (1-indexed, must be >= startPage)"),
      folderName: z.union([z.string(), z.array(z.string())]).optional(),
      endUserId: z.string().optional(),
    },
    async ({ documentId, startPage, endPage, folderName, endUserId }) => {
      if (endPage < startPage) {
        return { content: [{ type: "text", text: "endPage must be greater than or equal to startPage." }], isError: true };
      }
      if (endPage - startPage >= 10) {
        return { content: [{ type: "text", text: "Please limit page ranges to 10 pages or fewer." }], isError: true };
      }

      const requestBody: Record<string, any> = {
        document_id: documentId,
        start_page: startPage,
        end_page: endPage,
      };

      const normalizedFolder = normalizeFolderParam(folderName);
      if (normalizedFolder) requestBody.folder_name = normalizedFolder;
      if (endUserId) requestBody.end_user_id = endUserId;

      const response = await makeMorphikRequest<DocumentPagesResponse>({
        url: "/documents/pages",
        method: "POST",
        body: requestBody,
        config,
      });

      if (!response || !Array.isArray(response.pages) || response.pages.length === 0) {
        return { content: [{ type: "text", text: "No page data was returned for that range." }] };
      }

      const documentDetails = await makeMorphikRequest<Document>({
        url: `/documents/${documentId}`,
        method: "GET",
        config,
      });
      const filename = documentDetails?.filename || documentId;

      const content: McpContentItem[] = [];

      for (let i = 0; i < response.pages.length; i++) {
        const pageNumber = response.start_page + i;
        const pageData = response.pages[i];
        if (!pageData) continue;

        const { data, mimeType } = stripDataUri(pageData);
        try {
          const resized = await resizeImageIfNeeded(data);
          content.push({ type: "text", text: `Page ${pageNumber} from "${filename}" (${documentId})` });
          content.push({ type: "image", data: resized.data, mimeType: resized.mimeType || mimeType });
        } catch (error) {
          console.error("Error processing page image:", error);
          content.push({ type: "text", text: `Unable to render page ${pageNumber}.` });
        }
      }

      if (!content.length) {
        return { content: [{ type: "text", text: "No pages could be rendered from the requested range." }] };
      }

      return { content };
    },
  );

  // 6. List Documents (next-gen list_docs endpoint)
  server.tool(
    "list-documents",
    "List documents with optional metadata filters. Supports high limits, folder scoping, and returning total counts.",
    {
      skip: z.number().min(0).optional(),
      limit: z.number().min(0).max(10000).optional(),
      filters: z.record(z.any()).optional(),
      folderName: z.union([z.string(), z.array(z.string())]).optional(),
      endUserId: z.string().optional(),
      getCount: z.boolean().optional().describe("If true, return the total count instead of document details."),
      fields: z.array(z.string()).optional().describe("Optional subset of document fields to return."),
      sortBy: z.enum(["created_at", "updated_at", "filename", "external_id"]).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
    },
    async ({ skip, limit, filters, folderName, endUserId, getCount, fields, sortBy, sortDirection }) => {
      const combinedFilters = combineFilters(filters);
      const requestBody: ListDocsRequest = {
        skip: skip ?? 0,
        limit: getCount ? 0 : limit ?? 20,
        document_filters: combinedFilters ?? undefined,
        return_documents: !getCount,
        include_total_count: !!getCount,
        include_status_counts: false,
        include_folder_counts: false,
        sort_by: sortBy ?? "updated_at",
        sort_direction: sortDirection ?? "desc",
        fields: getCount ? null : fields ?? ["external_id", "filename"],
      };

      const url = new URL(`${config.apiBase}/documents/list_docs`);
      const normalizedFolder = normalizeFolderParam(folderName);
      if (normalizedFolder) buildFolderQueryParams(url, normalizedFolder);
      if (endUserId) url.searchParams.set("end_user_id", endUserId);

      const response = await makeMorphikRequest<Record<string, any>>({
        url: url.toString(),
        method: "POST",
        body: requestBody,
        config,
      });

      if (!response) {
        return { content: [{ type: "text", text: "Failed to list documents." }] };
      }

      if (getCount) {
        const total = typeof response.total_count === "number" ? response.total_count : 0;
        return { content: [{ type: "text", text: `Total accessible documents: ${total}` }] };
      }

      const documents = Array.isArray(response.documents) ? response.documents : [];
      if (!documents.length) {
        return { content: [{ type: "text", text: "No documents are currently available." }] };
      }

      const entries = documents
        .map((doc: Record<string, any>, index: number) => {
          const filename = typeof doc.filename === "string" && doc.filename.trim().length ? doc.filename : "Untitled";
          const externalId = typeof doc.external_id === "string" ? doc.external_id : "unknown";
          return `${index + 1}. ${filename} (ID: ${externalId})`;
        })
        .join("\n");

      const footer = typeof response.has_more === "boolean" && response.has_more ? "\nMore documents available..." : "";
      return { content: [{ type: "text", text: `${entries}${footer}` }] };
    },
  );

  // 7. Get Document
  server.tool(
    "get-document",
    "Lookup metadata for a document by ID.",
    { documentId: z.string() },
    async ({ documentId }) => {
      const response = await makeMorphikRequest<Document>({
        url: `/documents/${documentId}`,
        method: "GET",
        config,
      });

      if (!response) {
        return { content: [{ type: "text", text: `Document with ID ${documentId} not found` }] };
      }

      return { content: [{ type: "text", text: processDocumentResponse(response) }] };
    },
  );

  // 8. Delete Document
  server.tool(
    "delete-document",
    "Delete a document and all of its derived data.",
    { documentId: z.string() },
    async ({ documentId }) => {
      const response = await makeMorphikRequest<Record<string, any>>({
        url: `/documents/${documentId}`,
        method: "DELETE",
        config,
      });

      if (!response) {
        return { content: [{ type: "text", text: `Failed to delete document with ID ${documentId}` }] };
      }

      return { content: [{ type: "text", text: `Successfully deleted document with ID ${documentId}` }] };
    },
  );

  // 9. Check Ingestion Status
  server.tool(
    "check-ingestion-status",
    "Check processing status for a document that is being ingested or processed.",
    { documentId: z.string() },
    async ({ documentId }) => {
      const response = await makeMorphikRequest<Record<string, any>>({
        url: `/documents/${documentId}/status`,
        method: "GET",
        config,
      });

      if (!response) {
        return { content: [{ type: "text", text: `Failed to get status for document with ID ${documentId}` }] };
      }

      const statusLines = Object.entries(response)
        .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
        .join("\n");
      return { content: [{ type: "text", text: `Document Status for ID: ${documentId}\n\n${statusLines}` }] };
    },
  );

  // 10. Metadata Filters Management
  server.tool(
    "morphik-filters",
    "Show, set, or clear typed metadata filters that automatically apply to retrieval and list commands.",
    {
      action: z.enum(["show", "set", "clear", "reset"]).optional(),
      expression: z.record(z.any()).optional(),
      expressionJson: z.string().optional(),
      rules: z
        .array(
          z.object({
            key: z.string(),
            operator: z.enum(["eq", "regex", "number_range", "date_range"]).optional(),
            value: z.any().optional(),
            min: z.number().optional(),
            max: z.number().optional(),
            from: z.string().optional(),
            to: z.string().optional(),
          }),
        )
        .optional(),
      logic: z.enum(["and", "or"]).optional(),
    },
    async ({ action, expression, expressionJson, rules, logic }) => {
      const resolvedAction = action || (expression || expressionJson || rules ? "set" : "show");

      if (resolvedAction === "show") {
        return { content: [{ type: "text", text: formatMetadataFilter(activeMetadataFilter) }] };
      }

      if (resolvedAction === "clear" || resolvedAction === "reset") {
        activeMetadataFilter = null;
        return { content: [{ type: "text", text: "Metadata filters cleared." }] };
      }

      try {
        let parsedExpression: MetadataFilter | undefined;

        if (expression && Object.keys(expression).length > 0) {
          parsedExpression = expression;
        } else if (expressionJson) {
          parsedExpression = JSON.parse(expressionJson) as MetadataFilter;
        } else if (rules && rules.length > 0) {
          parsedExpression = parseRulesToFilter(rules, logic ?? "and");
        }

        if (!parsedExpression) {
          return {
            content: [{ type: "text", text: "Provide `expression`, `expressionJson`, or `rules` to set filters." }],
            isError: true,
          };
        }

        activeMetadataFilter = parsedExpression;
        return {
          content: [
            {
              type: "text",
              text: `Metadata filters updated.\n\n${formatMetadataFilter(activeMetadataFilter)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Unable to update metadata filters: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
