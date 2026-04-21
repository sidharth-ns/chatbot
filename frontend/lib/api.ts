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
  health: () => fetchAPI<{ status: string }>("/api/health"),

  // Documents / Indexing
  uploadFiles: async (files: File[]) => {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }
    const res = await fetch(`${API_URL}/api/documents/upload`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Upload error ${res.status}: ${body}`);
    }
    return res.json();
  },

  indexFolder: (folderPath: string) =>
    fetchAPI("/api/documents/index-folder", {
      method: "POST",
      body: JSON.stringify({ folder_path: folderPath }),
    }),

  indexStatus: () => fetchAPI<IndexStatus>("/api/documents/index-status"),

  listDocuments: () => fetchAPI<Document[]>("/api/documents"),

  getDocument: (id: string) => fetchAPI<DocumentDetail>(`/api/documents/${id}`),

  deleteDocument: (id: string) =>
    fetchAPI(`/api/documents/${id}`, { method: "DELETE" }),

  reindexAll: () =>
    fetchAPI("/api/documents/reindex", { method: "POST" }),

  // Chat sessions
  createSession: () =>
    fetchAPI<ChatSession>("/api/chat/sessions", { method: "POST" }),

  listSessions: () => fetchAPI<ChatSession[]>("/api/chat/sessions"),

  getSessionMessages: (sessionId: string) =>
    fetchAPI<Message[]>(`/api/chat/sessions/${sessionId}`),

  deleteSession: (sessionId: string) =>
    fetchAPI(`/api/chat/sessions/${sessionId}`, { method: "DELETE" }),

  stopStream: (sessionId: string) =>
    fetchAPI("/api/chat/stop", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    }),

  starterQuestions: () =>
    fetchAPI<{ questions: string[] }>("/api/chat/starter-questions"),

  // Checklist
  checklistConfig: () => fetchAPI<ChecklistConfig>("/api/checklist/config"),

  checklistState: (sessionId: string) =>
    fetchAPI<ChecklistState>(`/api/checklist/state/${sessionId}`),

  checklistAnswer: (
    sessionId: string,
    questionId: string,
    answer: boolean
  ) =>
    fetchAPI("/api/checklist/answer", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionId,
        question_id: questionId,
        answer,
      }),
    }),

  checklistSkip: (sessionId: string) =>
    fetchAPI("/api/checklist/skip", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    }),

  checklistReset: (sessionId: string) =>
    fetchAPI("/api/checklist/reset", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    }),

  checklistHelp: (questionId: string) =>
    fetchAPI<HelpContent>(`/api/checklist/help/${questionId}`),
};

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat error ${res.status}: ${body}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  // Helper: yield control to browser so React can re-render between tokens
  const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines (each event ends with \n\n)
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || ""; // Keep incomplete part in buffer

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6); // Remove "data: " prefix
        try {
          const parsed = JSON.parse(jsonStr);
          onEvent(parsed as SSEEvent);

          // After each token, yield to browser so React renders the update
          if (parsed.type === "token") {
            await yieldToUI();
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
