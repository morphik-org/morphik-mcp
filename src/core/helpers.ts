import { Document } from "./types.js";

// Helper function for determining MIME type
export function getMimeType(fileName: string): string {
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