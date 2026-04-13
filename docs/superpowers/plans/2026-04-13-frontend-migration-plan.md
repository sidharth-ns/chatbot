# OnboardBot Frontend Migration Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js 14 frontend that connects to the FastAPI backend (Plan A, already complete). ChatGPT-like UI with streaming responses, persistent sessions, onboarding checklist, and document upload.

**Architecture:** Next.js 14 App Router with client components for interactive features. Tailwind CSS + shadcn/ui for styling. React Query for server state, Zustand for client state. SSE via eventsource-parser for streaming chat.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, TanStack React Query, Zustand, eventsource-parser

**Spec:** `docs/superpowers/specs/2026-04-13-nextjs-fastapi-migration-design.md`
**Backend:** Running at `http://localhost:8000` with all endpoints working.

---

## Task 1: Frontend Scaffolding

**Files:**
- Create: `frontend/` — Next.js 14 project
- Create: `frontend/lib/types.ts` — TypeScript types matching API schemas
- Create: `frontend/lib/api.ts` — API client with fetch wrappers
- Create: `frontend/lib/store.ts` — Zustand store

- [ ] **Step 1: Create Next.js project**

```bash
cd /Users/innovinlabs/Desktop/InnovinLabs/chatbot
npx create-next-app@14 frontend --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm
```

- [ ] **Step 2: Install dependencies**

```bash
cd frontend
npm install @tanstack/react-query zustand eventsource-parser
npm install -D @types/node
npx shadcn@latest init -d
npx shadcn@latest add button input card scroll-area separator badge textarea skeleton collapsible
```

- [ ] **Step 3: Configure environment**

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 4: Create TypeScript types**

Write to `frontend/lib/types.ts`:
```typescript
export interface Document {
  id: string;
  filename: string;
  doc_name: string | null;
  node_count: number;
  description: string | null;
  indexed_at: string;
}

export interface DocumentDetail extends Document {
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

// SSE event types
export type SSEEvent =
  | { type: "stream_start"; data: { stream_id: string } }
  | { type: "search_start" }
  | { type: "sources"; data: Source[] }
  | { type: "token"; data: string }
  | { type: "done"; data: { full_response: string; sources: Source[]; followups: string[] } }
  | { type: "stopped"; data: { partial_response: string } }
  | { type: "error"; data: { message: string } };
```

- [ ] **Step 5: Create API client**

Write to `frontend/lib/api.ts`:
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API error: ${res.status}`);
  }
  return res.json();
}

// Documents
export const api = {
  // Health
  health: () => fetchAPI<{ status: string; db: string }>("/api/health"),

  // Documents
  uploadFile: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_URL}/api/documents/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  indexFolder: (folderPath: string) =>
    fetchAPI("/api/documents/index-folder", {
      method: "POST",
      body: JSON.stringify({ folder_path: folderPath }),
    }),

  indexStatus: () => fetchAPI<any>("/api/documents/index-status"),

  listDocuments: () => fetchAPI<any[]>("/api/documents"),

  getDocument: (id: string) => fetchAPI<any>(`/api/documents/${id}`),

  deleteDocument: (id: string) =>
    fetchAPI(`/api/documents/${id}`, { method: "DELETE" }),

  reindexAll: () =>
    fetchAPI("/api/documents/reindex", { method: "POST" }),

  // Chat
  createSession: () =>
    fetchAPI<{ id: string }>("/api/chat/sessions", { method: "POST" }),

  listSessions: () => fetchAPI<any[]>("/api/chat/sessions"),

  getSessionMessages: (sessionId: string) =>
    fetchAPI<any[]>(`/api/chat/sessions/${sessionId}`),

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
  checklistConfig: () => fetchAPI<any>("/api/checklist/config"),

  checklistState: (sessionId: string) =>
    fetchAPI<any>(`/api/checklist/state/${sessionId}`),

  checklistAnswer: (sessionId: string, questionId: string, answer: boolean) =>
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
    fetchAPI<any>(`/api/checklist/help/${questionId}`),
};

// SSE streaming for chat
export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: any) => void,
  signal?: AbortSignal
): Promise<void> {
  const { createParser } = await import("eventsource-parser");

  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Chat failed: ${response.status}`);
  }

  const parser = createParser({
    onEvent: (event) => {
      if (event.data) {
        try {
          onEvent(JSON.parse(event.data));
        } catch {
          // ignore malformed events
        }
      }
    },
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
}
```

- [ ] **Step 6: Create Zustand store**

Write to `frontend/lib/store.ts`:
```typescript
import { create } from "zustand";

interface AppStore {
  // Active session
  sessionId: string | null;
  setSessionId: (id: string | null) => void;

  // Streaming state
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  streamId: string | null;
  setStreamId: (id: string | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useStore = create<AppStore>((set) => ({
  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),

  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),
  streamId: null,
  setStreamId: (id) => set({ streamId: id }),

  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

- [ ] **Step 7: Setup React Query provider**

Write to `frontend/app/providers.tsx`:
```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

- [ ] **Step 8: Test the scaffolding**

```bash
cd frontend
npm run dev
```

Open http://localhost:3000 — should see the default Next.js page.

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat: frontend scaffolding — Next.js 14, Tailwind, shadcn/ui, API client, Zustand"
```

---

## Task 2: Layout + Sidebar

**Files:**
- Modify: `frontend/app/layout.tsx`
- Create: `frontend/components/sidebar.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Create sidebar component**

Write to `frontend/components/sidebar.tsx` — a collapsible sidebar with:
- App logo + title "OnboardBot"
- Navigation links: Upload Docs, Chat
- "New Chat" button
- List of past chat sessions (from `api.listSessions()` via React Query)
- List of indexed documents (from `api.listDocuments()` via React Query)
- Uses shadcn/ui Button, ScrollArea, Separator

The sidebar should:
- Use `useQuery` to fetch sessions and documents
- Show session titles (truncated) with click to navigate to `/chat/[sessionId]`
- Show document filenames with node counts
- "New Chat" button creates session via `api.createSession()` and navigates to `/chat/[sessionId]`
- Use `useStore` for sidebar open/close toggle
- Be a `"use client"` component

- [ ] **Step 2: Update root layout**

Modify `frontend/app/layout.tsx`:
- Import Providers and Sidebar
- Use a flex layout: sidebar (fixed 280px) + main content area
- Wrap children in `<Providers>`
- Dark mode by default (add `className="dark"` to `<html>`)

- [ ] **Step 3: Create home page**

Write `frontend/app/page.tsx`:
- Title: "OnboardBot"
- Subtitle: "Your AI-Powered Onboarding Assistant"
- Brief description of how it works (3 cards: Upload Docs, Onboarding Checklist, Chat with Docs)
- Link buttons to /upload and /chat
- Show indexed document count if any
- Server component that fetches from API

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat: layout with sidebar, home page — navigation, sessions, documents"
```

---

## Task 3: Upload Page

**Files:**
- Create: `frontend/app/upload/page.tsx`
- Create: `frontend/components/file-uploader.tsx`
- Create: `frontend/components/indexing-progress.tsx`
- Create: `frontend/components/tree-view.tsx`

- [ ] **Step 1: Create file uploader component**

Write to `frontend/components/file-uploader.tsx`:
- Drag-and-drop zone for .md files (use HTML drag events + shadcn Card styling)
- File input with accept=".md,.markdown"
- Show selected files list with remove button
- "Upload & Index" button that calls `api.uploadFile()` for each file
- Disabled during indexing

- [ ] **Step 2: Create indexing progress component**

Write to `frontend/components/indexing-progress.tsx`:
- Uses `useQuery` with `api.indexStatus()` polling every 1 second (refetchInterval: 1000) while indexing is active
- Shows progress bar (indexed / total)
- Shows current file being indexed
- Shows error if any
- Stops polling when complete

- [ ] **Step 3: Create tree view component**

Write to `frontend/components/tree-view.tsx`:
- Accepts a document's tree_json
- Renders nested nodes as an expandable tree (use Collapsible from shadcn)
- Each node shows: node_id badge + title
- Indented by depth

- [ ] **Step 4: Create upload page**

Write to `frontend/app/upload/page.tsx`:
- "Upload & Index Documentation" title
- FileUploader component
- IndexingProgress component (shown when indexing active)
- List of indexed documents below (from `api.listDocuments()` via useQuery)
- Each document expandable to show TreeView
- Delete button per document
- "Re-index All" button

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: upload page — file uploader, indexing progress, tree view"
```

---

## Task 4: Chat Page — Message Components

**Files:**
- Create: `frontend/components/chat-message.tsx`
- Create: `frontend/components/source-card.tsx`
- Create: `frontend/components/suggestion-chips.tsx`
- Create: `frontend/components/chat-input.tsx`

- [ ] **Step 1: Create chat message component**

Write to `frontend/components/chat-message.tsx`:
- Accepts: role ("user" | "assistant"), content (string), sources (Source[] | null)
- User messages: right-aligned, blue background
- Assistant messages: left-aligned, gray background
- Renders markdown content (use a simple markdown renderer or dangerouslySetInnerHTML with basic sanitization)
- For assistant messages with sources: render SourceCard below the message

- [ ] **Step 2: Create source card component**

Write to `frontend/components/source-card.tsx`:
- Expandable card showing source citations
- Header: "Sources (N sections from M files)" — clickable to expand
- Each source shows: file_name > heading_path, snippet preview
- Uses shadcn Collapsible

- [ ] **Step 3: Create suggestion chips component**

Write to `frontend/components/suggestion-chips.tsx`:
- Accepts: questions (string[]), onSelect callback, disabled flag
- Renders as a row of clickable buttons/chips
- Wraps to next line if too many
- Disabled when isStreaming

- [ ] **Step 4: Create chat input component**

Write to `frontend/components/chat-input.tsx`:
- Text input + Send button (or Stop button during streaming)
- Submit on Enter (Shift+Enter for newline)
- Disabled when streaming (shows "Generating response...")
- Stop button calls `api.stopStream(sessionId)`
- Uses shadcn Input and Button

- [ ] **Step 5: Commit**

```bash
git add frontend/components/
git commit -m "feat: chat components — message, source card, suggestions, input"
```

---

## Task 5: Chat Page — Interface + Streaming

**Files:**
- Create: `frontend/components/chat-interface.tsx`
- Create: `frontend/components/checklist-flow.tsx`
- Create: `frontend/app/chat/page.tsx`
- Create: `frontend/app/chat/[sessionId]/page.tsx`

- [ ] **Step 1: Create chat interface component**

Write to `frontend/components/chat-interface.tsx` — the main chat area:
- Accepts: sessionId
- Loads message history from `api.getSessionMessages(sessionId)` via useQuery
- Renders messages as ChatMessage components in a ScrollArea
- Auto-scrolls to bottom on new messages
- Shows SuggestionChips for starter questions (when history is empty) or follow-ups (after last assistant message)
- Fixed ChatInput at bottom
- On send: calls `streamChat()` from lib/api.ts
- During streaming: accumulates tokens into a "pending" assistant message, shows sources when received
- On done: invalidates the messages query to refresh from DB, stores follow-ups
- On error: shows error message in chat
- Uses useStore for isStreaming/streamId state

- [ ] **Step 2: Create checklist flow component**

Write to `frontend/components/checklist-flow.tsx`:
- Accepts: sessionId
- Loads checklist config from `api.checklistConfig()` and state from `api.checklistState(sessionId)`
- Computes current question (first question whose ID is not in answers)
- Renders as chat messages: welcome message, then each answered question + response, then current question with Yes/No buttons
- On "Yes": call `api.checklistAnswer(sessionId, questionId, true)`, invalidate state query
- On "No": call `api.checklistAnswer(sessionId, questionId, false)`, fetch help content from `api.checklistHelp(questionId)`, display inline
- Shows progress bar (completed / total)
- "Skip Checklist" button
- When complete: show completion message, transition to ChatInterface

- [ ] **Step 3: Create chat page (new session)**

Write to `frontend/app/chat/page.tsx`:
- On mount: create a new session via `api.createSession()`
- Redirect to `/chat/[sessionId]` using `router.push()`
- Show loading spinner while creating

- [ ] **Step 4: Create chat session page**

Write to `frontend/app/chat/[sessionId]/page.tsx`:
- Get sessionId from params
- Store in Zustand store
- Load checklist state to determine if checklist is complete
- If not complete: render ChecklistFlow
- If complete: render ChatInterface
- Save sessionId to localStorage for return visits

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: chat page — checklist flow, chat interface, SSE streaming"
```

---

## Task 6: Polish + Docker Compose

**Files:**
- Modify: `frontend/app/layout.tsx` — final styling
- Create: `frontend/Dockerfile`
- Modify: root `docker-compose.yml`

- [ ] **Step 1: Add dark theme styling**

Update `frontend/app/globals.css` for dark mode defaults and custom styling.
Update `frontend/tailwind.config.ts` if needed.

- [ ] **Step 2: Create frontend Dockerfile**

Write to `frontend/Dockerfile`:
```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

Update `frontend/next.config.mjs` to add `output: "standalone"`.

- [ ] **Step 3: Update root docker-compose.yml**

```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    volumes:
      - ./backend/sample_docs:/app/sample_docs
    depends_on:
      - db

  db:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: admin
      POSTGRES_DB: onboardbot
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 4: Integration test**

```bash
# Start backend
cd backend && source .venv/bin/activate && uvicorn main:app --port 8000 &

# Start frontend
cd frontend && npm run dev &

# Open http://localhost:3000
# Test: Upload docs → Checklist → Chat → Verify streaming works
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: frontend complete — chat, upload, checklist, Docker Compose"
```

---

## Summary

| Task | What | Depends On |
|------|------|------------|
| 1 | Frontend scaffolding (Next.js, types, API client, Zustand) | Backend running |
| 2 | Layout + sidebar + home page | Task 1 |
| 3 | Upload page (uploader, progress, tree view) | Task 1 |
| 4 | Chat components (message, sources, chips, input) | Task 1 |
| 5 | Chat page (checklist flow, interface, SSE streaming) | Tasks 2-4 |
| 6 | Polish + Docker Compose | Task 5 |
