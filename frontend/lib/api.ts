import { createParser } from "eventsource-parser";
import type {
  ChatSession,
  ChecklistConfig,
  ChecklistState,
  Document,
  DocumentDetail,
  HelpContent,
  IndexStatus,
  Message,
  SSEEvent,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Health
  health: () => fetchAPI<{ status: string }>("/health"),

  // Documents / Indexing
  uploadFile: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/index/upload`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }
    return res.json() as Promise<Document>;
  },

  indexFolder: (path: string) =>
    fetchAPI<{ indexed: number; skipped: number; errors: string[] }>(
      "/index/folder",
      {
        method: "POST",
        body: JSON.stringify({ path }),
      }
    ),

  indexStatus: () => fetchAPI<IndexStatus>("/index/status"),

  listDocuments: () => fetchAPI<Document[]>("/documents"),

  getDocument: (id: string) => fetchAPI<DocumentDetail>(`/documents/${id}`),

  deleteDocument: (id: string) =>
    fetchAPI<{ ok: boolean }>(`/documents/${id}`, { method: "DELETE" }),

  reindexAll: () =>
    fetchAPI<{ indexed: number }>("/index/reindex", { method: "POST" }),

  // Chat sessions
  createSession: () =>
    fetchAPI<ChatSession>("/chat/sessions", { method: "POST" }),

  listSessions: () => fetchAPI<ChatSession[]>("/chat/sessions"),

  getSessionMessages: (id: string) =>
    fetchAPI<Message[]>(`/chat/sessions/${id}/messages`),

  deleteSession: (id: string) =>
    fetchAPI<{ ok: boolean }>(`/chat/sessions/${id}`, { method: "DELETE" }),

  stopStream: (sessionId: string) =>
    fetchAPI<{ ok: boolean }>(`/chat/sessions/${sessionId}/stop`, {
      method: "POST",
    }),

  starterQuestions: () =>
    fetchAPI<{ questions: string[] }>("/chat/starter-questions"),

  // Checklist
  checklistConfig: () => fetchAPI<ChecklistConfig>("/checklist/config"),

  checklistState: (sessionId: string) =>
    fetchAPI<ChecklistState>(`/checklist/${sessionId}/state`),

  checklistAnswer: (
    sessionId: string,
    questionId: string,
    answer: string
  ) =>
    fetchAPI<ChecklistState>(`/checklist/${sessionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ question_id: questionId, answer }),
    }),

  checklistSkip: (sessionId: string) =>
    fetchAPI<ChecklistState>(`/checklist/${sessionId}/skip`, {
      method: "POST",
    }),

  checklistReset: (sessionId: string) =>
    fetchAPI<ChecklistState>(`/checklist/${sessionId}/reset`, {
      method: "POST",
    }),

  checklistHelp: (questionId: string) =>
    fetchAPI<HelpContent>(`/checklist/help/${questionId}`),
};

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const parser = createParser({
    onEvent: (event) => {
      try {
        const eventType = event.event || "unknown";
        const data = event.data ? JSON.parse(event.data) : undefined;

        switch (eventType) {
          case "stream_start":
            onEvent({ type: "stream_start", data });
            break;
          case "search_start":
            onEvent({ type: "search_start" });
            break;
          case "sources":
            onEvent({ type: "sources", data });
            break;
          case "token":
            onEvent({ type: "token", data });
            break;
          case "done":
            onEvent({ type: "done", data });
            break;
          case "stopped":
            onEvent({ type: "stopped", data });
            break;
          case "error":
            onEvent({ type: "error", data });
            break;
        }
      } catch {
        // Ignore malformed events
      }
    },
  });

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
