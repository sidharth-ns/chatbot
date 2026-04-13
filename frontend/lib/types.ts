export interface Document {
  id: string;
  filename: string;
  doc_name: string | null;
  node_count: number;
  description: string | null;
  indexed_at: string;
}

export interface DocumentDetail extends Document {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tree_json: Record<string, any>;
  file_hash: string;
}

export interface IndexStatus {
  indexed: number;
  pending: number;
  documents: Document[];
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message: string | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[] | null;
  created_at: string;
}

export interface Source {
  file_name: string;
  heading_path: string;
  snippet: string;
}

export interface ChecklistConfig {
  welcome_message: string;
  completion_message: string;
  questions: ChecklistQuestion[];
}

export interface ChecklistQuestion {
  id: string;
  question: string;
  search_terms: string[];
  on_no: {
    message: string;
    command: string | null;
    link: string | null;
  };
}

export interface ChecklistState {
  id: string;
  session_id: string;
  answers: Record<string, string>;
  skipped: boolean;
}

export interface HelpContent {
  message: string;
  command: string | null;
  link: string | null;
  doc_content: string | null;
}

export type SSEEvent =
  | { type: "stream_start"; data: { stream_id: string } }
  | { type: "search_start" }
  | { type: "sources"; data: Source[] }
  | { type: "token"; data: string }
  | { type: "done"; data: { full_response: string; sources: Source[]; followups: string[] } }
  | { type: "stopped"; data: { partial_response: string } }
  | { type: "error"; data: { message: string } };
