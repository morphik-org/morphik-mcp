// Morphik API interfaces based on OpenAPI spec
export interface Document {
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

export interface StorageFileInfo {
  bucket: string;
  key: string;
  version?: number;
  filename?: string;
  content_type?: string;
  timestamp?: string;
}

export interface IngestTextRequest {
  content: string;
  filename?: string;
  metadata?: Record<string, any>;
  rules?: Record<string, any>[];
  use_colpali?: boolean;
  folder_name?: string;
  end_user_id?: string;
}

export interface ChunkResult {
  content: string;
  score: number;
  document_id: string;
  chunk_number: number;
  metadata: Record<string, any>;
  content_type: string;
  filename?: string;
  download_url?: string;
}

export interface DocumentResult {
  score: number;
  document_id: string;
  metadata: Record<string, any>;
  content: DocumentContent;
  additional_metadata: Record<string, any>;
}

export interface DocumentContent {
  type: "url" | "string";
  value: string;
  filename?: string;
}

export interface RetrieveRequest {
  query: string;
  filters?: Record<string, any>;
  k?: number;
  min_score?: number;
  use_reranking?: boolean;
  use_colpali?: boolean;
  padding?: number;
  graph_name?: string;
  hop_depth?: number;
  include_paths?: boolean;
  folder_name?: string | string[];
  end_user_id?: string;
}

export interface ListDocsRequest {
  document_filters?: Record<string, any> | null;
  skip?: number;
  limit?: number;
  return_documents?: boolean;
  include_total_count?: boolean;
  include_status_counts?: boolean;
  include_folder_counts?: boolean;
  sort_by?: 'created_at' | 'updated_at' | 'filename' | 'external_id' | null;
  sort_direction?: 'asc' | 'desc';
  fields?: string[] | null;
}

export interface DocumentPagesRequest {
  document_id: string;
  start_page: number;
  end_page: number;
  folder_name?: string | string[] | null;
  end_user_id?: string | null;
}

export interface DocumentPagesResponse {
  document_id: string;
  pages: string[];
  start_page: number;
  end_page: number;
  total_pages: number;
}

// File operation interfaces
export interface ListDirectoryResult {
  entries: {
    name: string;
    type: 'file' | 'directory';
    path: string;
  }[];
}

export interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

export interface SearchFilesResult {
  matches: string[];
}

// Configuration interfaces
export interface MorphikConfig {
  apiBase: string;
  authToken: string;
  userAgent: string;
  allowedDirectories: string[];
}
