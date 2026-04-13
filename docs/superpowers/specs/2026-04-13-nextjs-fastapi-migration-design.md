# OnboardBot Migration: Streamlit to Next.js + FastAPI

## Problem

OnboardBot currently runs as a Streamlit app — frontend and backend are tightly coupled. This limits UI customization, makes real-time streaming fragile (page switches kill responses), prevents proper session persistence (state lost on refresh), and locks us into Streamlit's widget system.

## Goal

Migrate to a separated architecture: **Next.js 14 frontend** + **FastAPI backend** + **PostgreSQL** for state persistence. Reuse all existing core logic (PageIndex indexing, tree search, Claude chat, checklist). Deliver a ChatGPT-like UI with streaming responses, persistent sessions, and proper file upload handling.

## Architecture

```
┌──────────────────┐     REST + SSE       ┌─────────────────┐
│  Next.js 14      │ ◄──────────────────► │  FastAPI        │
│  (App Router)    │                      │  (Python 3.11+) │
│                  │                      │                 │
│  Tailwind CSS    │                      │  core/          │
│  shadcn/ui       │                      │   indexer.py    │
│  React Query     │                      │   retrieval.py  │
│  Zustand         │                      │   chat.py       │
│                  │                      │   checklist.py  │
└──────────────────┘                      └────────┬────────┘
                                                   │
                                          ┌────────▼─────────┐
                                          │  PostgreSQL      │
                                          │  documents       │
                                          │  chat_sessions   │
                                          │  messages        │
                                          │  checklist_state │
                                          └──────────────────┘
```

### Monorepo Structure

```
onboardbot/
├── frontend/                      # Next.js 14
│   ├── app/
│   │   ├── layout.tsx             # Root layout with sidebar
│   │   ├── page.tsx               # Home page
│   │   ├── upload/
│   │   │   └── page.tsx           # Upload docs page
│   │   └── chat/
│   │       ├── page.tsx           # Chat (creates new session)
│   │       └── [sessionId]/
│   │           └── page.tsx       # Chat with existing session
│   ├── components/
│   │   ├── ui/                    # shadcn/ui components
│   │   ├── sidebar.tsx            # App sidebar
│   │   ├── chat-message.tsx       # Single message bubble
│   │   ├── chat-input.tsx         # Message input bar
│   │   ├── chat-interface.tsx     # Full chat area
│   │   ├── checklist-flow.tsx     # Onboarding checklist UI
│   │   ├── file-uploader.tsx      # Drag-and-drop file upload
│   │   ├── tree-view.tsx          # Document tree display
│   │   ├── source-card.tsx        # Source citation expander
│   │   ├── suggestion-chips.tsx   # Starter/follow-up buttons
│   │   └── indexing-progress.tsx  # Background indexing status
│   ├── lib/
│   │   ├── api.ts                 # API client (fetch wrappers)
│   │   ├── store.ts               # Zustand store
│   │   └── types.ts               # TypeScript types
│   ├── package.json
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
├── backend/                       # FastAPI
│   ├── main.py                    # FastAPI app entry point
│   ├── routers/
│   │   ├── upload.py              # Upload + indexing endpoints
│   │   ├── chat.py                # Chat + streaming endpoints
│   │   └── checklist.py           # Checklist endpoints
│   ├── core/                      # REUSED from current Streamlit app
│   │   ├── __init__.py
│   │   ├── indexer.py             # PageIndex wrapper (as-is)
│   │   ├── retrieval.py           # Tree search (as-is)
│   │   ├── chat_engine.py         # Claude integration (refactored SSE generator)
│   │   ├── checklist.py           # Checklist logic (refactored, no session_state)
│   │   └── document_store.py     # NEW: load/save trees between DB and core modules
│   ├── models/
│   │   ├── database.py            # SQLAlchemy engine + session
│   │   └── models.py              # ORM models
│   ├── schemas/
│   │   └── schemas.py             # Pydantic request/response models
│   ├── config/
│   │   ├── settings.py            # pydantic-settings based config
│   │   └── checklist_config.json  # Checklist questions
│   ├── alembic/                   # Database migrations
│   │   ├── versions/              # Migration scripts
│   │   └── env.py
│   ├── alembic.ini
│   ├── lib/PageIndex/             # Cloned PageIndex library
│   ├── sample_docs/               # Sample .md files
│   └── requirements.txt
│
├── docker-compose.yml             # Frontend + Backend + PostgreSQL
├── .env.example
└── README.md
```

## Backend Design (FastAPI)

### API Endpoints

#### Documents & Indexing

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Upload .md files (multipart form data). Starts background indexing. Returns job status. |
| `POST` | `/api/index-folder` | Accept a local folder path. Scan for .md files, start background indexing. |
| `GET` | `/api/index-status` | Poll background indexing progress. Returns `{running, progress, total, current_file, error}`. |
| `GET` | `/api/documents` | List all indexed documents with metadata (id, filename, node_count, description, indexed_at). |
| `GET` | `/api/documents/{id}` | Get full tree structure for one document. |
| `DELETE` | `/api/documents/{id}` | Remove a document from the index. |
| `POST` | `/api/documents/reindex` | Re-index all documents (force). |
| `GET` | `/api/health` | Health check — returns `{"status": "ok", "db": "connected"}`. |

#### Chat & Streaming

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat/sessions` | Create a new chat session. Returns `{session_id}`. |
| `GET` | `/api/chat/sessions` | List all sessions with last message preview. |
| `GET` | `/api/chat/sessions/{id}` | Get all messages for a session (with sources). |
| `DELETE` | `/api/chat/sessions/{id}` | Delete a session and its messages. |
| `POST` | `/api/chat` | Send a message. Streams response via SSE. Body: `{session_id, message}`. Returns `{stream_id}` in first SSE event. |
| `POST` | `/api/chat/stop` | Stop an active stream. Body: `{session_id, stream_id}`. Saves partial response to DB. |
| `GET` | `/api/chat/starter-questions` | Generate starter questions based on indexed docs. |

#### Onboarding Checklist

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/checklist/config` | Get checklist question definitions. |
| `GET` | `/api/checklist/state/{session_id}` | Get current checklist answers for a session. |
| `POST` | `/api/checklist/answer` | Record a yes/no answer. Body: `{session_id, question_id, answer}`. |
| `POST` | `/api/checklist/skip` | Mark checklist as skipped. Body: `{session_id}`. |
| `POST` | `/api/checklist/reset` | Reset checklist. Body: `{session_id}`. |
| `GET` | `/api/checklist/help/{question_id}` | Get help content (static + doc search). |

### SSE Streaming Protocol

The `POST /api/chat` endpoint returns `text/event-stream`:

```
data: {"type": "search_start"}
data: {"type": "sources", "data": [{"file_name": "SETUP.md", "heading_path": "Installation > Database", "snippet": "Install PostgreSQL..."}]}
data: {"type": "token", "data": "According"}
data: {"type": "token", "data": " to"}
data: {"type": "token", "data": " **SETUP.md**"}
...
data: {"type": "done", "data": {"followups": ["How does auth work?", "What about migrations?"]}}
```

Event types:
- `stream_start` — streaming begun, includes `stream_id` for stop control
- `search_start` — retrieval phase started (show spinner)
- `sources` — retrieved nodes (display in sources panel)
- `token` — streaming text chunk (append to message)
- `done` — response complete (show follow-ups, save to DB)
- `stopped` — stream was stopped by user (partial response saved to DB)
- `error` — error occurred (show error message)

### Stop Streaming

The user can stop a streaming response mid-generation:

```
1. POST /api/chat starts streaming → first event includes stream_id
   data: {"type": "stream_start", "data": {"stream_id": "str-uuid-123"}}

2. User clicks "Stop" button in frontend
   POST /api/chat/stop {session_id: "abc", stream_id: "str-uuid-123"}

3. Backend sets a cancellation flag for that stream_id
   The streaming loop checks this flag each iteration

4. Stream emits final event:
   data: {"type": "stopped", "data": {"partial_response": "According to..."}}

5. Backend saves the PARTIAL response to messages table
   (marked with sources=null since retrieval was complete but answer was cut short)

6. Frontend shows the partial text with a "[Response stopped]" indicator
```

**Backend implementation:**
- Module-level dict `_active_streams: dict[str, bool]` tracks cancellation flags
- The SSE generator checks `_active_streams[stream_id]` before each Claude token yield
- `POST /api/chat/stop` sets the flag to `True`
- After stream ends (done or stopped), remove the entry from `_active_streams`

**Frontend implementation:**
- "Stop" button appears next to chat input during streaming (replaces "Send" button)
- Clicking it calls `POST /api/chat/stop` AND closes the ReadableStream reader
- Partial response is displayed with a visual indicator

### Database Schema

```sql
CREATE TABLE documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename    TEXT NOT NULL,
    doc_name    TEXT,
    file_hash   TEXT NOT NULL,
    tree_json   JSONB NOT NULL,      -- canonical source of truth for tree data
    node_count  INTEGER DEFAULT 0,
    description TEXT,
    indexed_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_documents_file_hash ON documents(file_hash);

CREATE TABLE chat_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT,              -- auto-generated from first message
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    sources     JSONB,             -- [{file_name, heading_path, snippet}]
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_session_id ON messages(session_id, created_at);

CREATE TABLE checklist_state (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    answers     JSONB DEFAULT '{}',
    skipped     BOOLEAN DEFAULT FALSE,
    UNIQUE(session_id)
);

-- Auto-update updated_at on chat_sessions when messages are added
CREATE OR REPLACE FUNCTION update_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_sessions SET updated_at = NOW() WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_session_on_message
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION update_session_timestamp();
```

### Data Source of Truth

- **PostgreSQL is the ONLY store** for tree JSON (`documents.tree_json`).
- No file-based cache (`pageindex_cache/`). Redis cache to be added later.
- After indexing, the upload router writes tree JSON directly to the DB via `document_store.py`.
- `indexer.py` will be modified to remove all `_load_from_cache`, `_save_to_cache`, `_cache_path` functions and the `CACHE_DIR` reference.

### Tree Materialization Layer

A new module `backend/core/document_store.py` bridges the DB and the core modules:

```python
# document_store.py — loads indexed trees from DB into the dict format
# that retrieval.py, chat_engine.py, and checklist.py expect.

from models.database import get_db
from models.models import Document

def load_indexed_trees(db) -> dict:
    """Load all indexed documents from DB into the indexed_trees dict format.
    
    Returns: {filename: {"tree": tree_dict, "file_hash": str, "indexed_at": str}}
    """
    docs = db.query(Document).all()
    return {
        doc.filename: {
            "tree": doc.tree_json,
            "file_hash": doc.file_hash,
            "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else "",
        }
        for doc in docs
    }

def save_document_to_db(db, filename, tree, file_hash):
    """Save or update a document's tree JSON in the DB after indexing."""
    existing = db.query(Document).filter(Document.filename == filename).first()
    if existing:
        existing.tree_json = tree
        existing.file_hash = file_hash
        existing.node_count = count_nodes_from_tree(tree)
        existing.description = tree.get("doc_description", "")
    else:
        doc = Document(
            filename=filename,
            doc_name=tree.get("doc_name", filename),
            file_hash=file_hash,
            tree_json=tree,
            node_count=count_nodes_from_tree(tree),
            description=tree.get("doc_description", ""),
        )
        db.add(doc)
    db.commit()
```

**Usage in routers:**
- Upload router: after `index_markdown_file()` completes, call `save_document_to_db()`.
- Chat router: call `load_indexed_trees(db)` to get the dict, pass to `search_trees()` and `stream_chat_response()`.
- Checklist router: call `load_indexed_trees(db)` for `get_help_content()`.

**Caching (future):** No caching in v1. Every request loads trees from PostgreSQL. Redis cache with TTL + invalidation on index to be added later. For now, PostgreSQL JSONB queries are fast enough for single-user use.

### Upload File Handling

The `POST /api/upload` endpoint:
1. Receives multipart file data
2. Validates file size (max `max_upload_size_mb` per file)
3. Writes files to a temp directory (`tempfile.mkdtemp()`)
4. Passes file paths to `start_bg_indexing()`
5. After indexing completes, the upload router calls `save_document_to_db()` for each result
6. Temp files are cleaned up after indexing finishes (in the background worker's finally block)

### Folder Path Security

The `POST /api/index-folder` endpoint:
- Accepts a folder path string
- Resolves to absolute path via `os.path.realpath()`
- Validates path starts with one of `settings.allowed_index_paths` (default: `["/app/sample_docs"]`)
- Rejects paths outside allowed prefixes with 403
- Add to Settings: `allowed_index_paths: list[str] = [os.path.join(BASE_DIR, "sample_docs")]`

### Core Module Reuse

| Module | Changes Needed |
|--------|---------------|
| `core/indexer.py` | Update settings imports. Remove all file-based caching functions (`_load_from_cache`, `_save_to_cache`, `_cache_path`, `CACHE_DIR`). The `index_markdown_file` function returns the tree dict; the router handles DB persistence via `document_store.py`. |
| `core/retrieval.py` | Update `from config.settings import ...` to use settings instance. |
| `core/chat_engine.py` | Rename from `chat.py`. **Significant refactor:** Current `stream_chat_response()` returns `(generator, sources)` synchronously. New version must yield SSE events (sources first, then tokens, then done with follow-ups) as a single async generator. Remove background chat threading. Remove `_bg_chat` state. Function signature changes from `-> tuple[Generator, list]` to `-> AsyncGenerator[dict]` where each dict is an SSE event. Follow-up generation happens after streaming completes, adding ~0.5s latency before the `done` event. |
| `core/checklist.py` | **Refactor all 8 functions** that accept `session_state` parameter. Replace with Pydantic model `ChecklistState(answers: dict, skipped: bool)`. Functions to refactor: `get_state`, `mark_answered`, `get_current_question`, `get_progress`, `is_complete`, `skip_checklist`, `reset_checklist`. Remove `init_state()`. Remove `checklist_step` and `checklist_messages` tracking (frontend manages conversation display). Keep `load_config()`, `get_help_content()` as-is. |
| `config/settings.py` | Switch to `pydantic-settings`. Remove Streamlit secrets fallback. Re-export constants for backward compatibility. |

### Configuration (pydantic-settings)

```python
import os
from pydantic_settings import BaseSettings

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/

class Settings(BaseSettings):
    anthropic_api_key: str
    openai_api_key: str = ""
    pageindex_model: str = "anthropic/claude-haiku-4-5-20251001"
    chat_model: str = "claude-sonnet-4-20250514"
    database_url: str = "postgresql+asyncpg://onboardbot:onboardbot@localhost:5432/onboardbot"
    cors_origins: list[str] = ["http://localhost:3000"]
    max_upload_size_mb: int = 10
    allowed_index_paths: list[str] = [os.path.join(BASE_DIR, "sample_docs")]
    
    class Config:
        env_file = ".env"

# Re-export as module-level constants for backward compatibility with core modules
settings = Settings()
ANTHROPIC_API_KEY = settings.anthropic_api_key
OPENAI_API_KEY = settings.openai_api_key
PAGEINDEX_MODEL = settings.pageindex_model
CHAT_MODEL = settings.chat_model
SAMPLE_DOCS_DIR = os.path.join(BASE_DIR, "sample_docs")
```

### Python Package Structure

`backend/` is the Python package root. Set via `PYTHONPATH=/app` in Docker or run from the `backend/` directory. The `from config.settings import ...` imports in core modules resolve relative to `backend/`.

### Authentication

**v1 (now):** No authentication. All endpoints are open. No user scoping on sessions, documents, or checklist state.

**v2 (future):** Self-hosted [Better Auth](https://www.better-auth.com/) integration. When added:
- Add `user_id` column to `chat_sessions`, `documents`, and `checklist_state` tables
- All queries scoped by authenticated user
- FastAPI dependency for extracting user from JWT/session token
- Next.js middleware for protecting routes

**Design for auth-readiness:** The DB schema does NOT include `user_id` now (avoids unused nullable columns), but the tables are structured so adding `user_id UUID REFERENCES users(id)` + index is a single Alembic migration with no data restructuring.

### Concurrency Model

**v1 (now):** Single async Uvicorn worker (`--workers 1`). One process handles all users concurrently via Python's `asyncio`. In-memory dicts for indexing jobs and stream cancellation are scoped by user session ID. Sufficient for ~100 concurrent users (the bottleneck is I/O-bound LLM API calls, which async handles well).

**v2 (future):** When scaling beyond ~100 concurrent users, add Redis to docker-compose. Move `_bg_indexing`, `_active_streams`, and tree caching to Redis. Then increase to `--workers N` (N = number of CPU cores). All workers share Redis for state and cache.

**In-memory state scoping for v1:**
```python
# Keyed by session_id so multiple users don't collide
_bg_indexing: dict[str, IndexingJob] = {}    # session_id → job state
_active_streams: dict[str, bool] = {}         # stream_id → cancelled flag
```

## Frontend Design (Next.js 14)

### Tech Stack

- **Next.js 14** with App Router (server components + client components)
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **shadcn/ui** for UI components (Button, Input, Card, ScrollArea, etc.)
- **React Query (TanStack Query)** for server state (API calls, caching, polling)
- **Zustand** for client state (active session ID, UI toggles)

### Pages

| Route | Description |
|-------|-------------|
| `/` | Home page — intro, quick start, navigation |
| `/upload` | Upload docs — file upload zone, folder path input, indexing progress |
| `/chat` | Chat — creates new session, redirects to `/chat/[sessionId]` |
| `/chat/[sessionId]` | Chat with session — checklist flow → free-form chat |

### Layout

Root layout with collapsible sidebar:
- App logo + title
- Navigation links (Upload, Chat)
- Indexed documents list (from `GET /api/documents`)
- Past chat sessions list (from `GET /api/chat/sessions`)
- "New Chat" button

### Key Components

**ChatInterface** — the main chat area:
- Scrollable message list with auto-scroll to bottom
- Each message rendered as `ChatMessage` component
- Assistant messages include `SourceCard` (expandable) and `SuggestionChips` (follow-ups)
- Fixed `ChatInput` at the bottom (disabled during streaming)

**ChecklistFlow** — onboarding checklist:
- Renders as chat messages with Yes/No buttons
- On "No" → fetches help content from API and displays inline
- Progress bar in sidebar
- "Skip" button to jump to free chat

**FileUploader** — document upload:
- Drag-and-drop zone (using shadcn/ui)
- Folder path text input
- Indexing progress bar (polls `/api/index-status` every 1s)
- Tree view of indexed documents

**Streaming Handler** — SSE consumption with proper buffering:
```typescript
// Use eventsource-parser (npm package) to handle chunk boundaries correctly.
// Raw ReadableStream chunks can split SSE events mid-line.
import { createParser } from 'eventsource-parser';

async function streamChat(sessionId: string, message: string, onEvent: (event: any) => void) {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message }),
    });

    if (!response.ok) {
        throw new Error(`Chat failed: ${response.status}`);
    }

    const parser = createParser((event) => {
        if (event.type === 'event' || event.type === 'reconnect-interval') return;
        if (event.data) {
            try {
                onEvent(JSON.parse(event.data));
            } catch {
                // Ignore malformed events
            }
        }
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

### Session Management

- Session ID stored in `localStorage`
- On first visit: create session via `POST /api/chat/sessions`
- On return visit: load session from `localStorage`, fetch history from API
- "New Chat" button creates new session, old sessions listed in sidebar
- Checklist state tied to session (so each session has its own checklist progress)

## Docker Compose

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
      - .env
    volumes:
      - ./backend/sample_docs:/app/sample_docs
    depends_on:
      - db

  db:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: onboardbot
      POSTGRES_PASSWORD: onboardbot
      POSTGRES_DB: onboardbot
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## Build Order

1. **Backend scaffolding** — FastAPI app, pydantic-settings (`config/settings.py` with `BASE_DIR`), CORS middleware, health endpoint. SQLAlchemy models in `models/`. Alembic setup (`backend/alembic/` directory, `alembic.ini`, initial migration for all 4 tables + trigger). Run with `uvicorn main:app --workers 1`.
2. **Document store + upload API** — Create `core/document_store.py` (load/save trees to DB). Upload router: multipart file upload to temp dir, background indexing, save to DB on completion, temp cleanup. Folder scan endpoint with path validation. Document CRUD endpoints. Invalidate in-memory tree cache on index.
3. **Chat API** — Refactor `core/chat_engine.py` (new SSE async generator signature). Session CRUD endpoints. `POST /api/chat` SSE endpoint: load trees from document_store, run search, stream tokens, generate follow-ups, emit `done`, save both messages to DB. Session title = first 50 chars of first user message.
4. **Checklist API** — Refactor `core/checklist.py` (replace session_state with Pydantic model, all 8 functions). Checklist endpoints. Help endpoint loads trees from document_store.
5. **Frontend scaffolding** — Next.js 14, Tailwind, shadcn/ui, API client (`lib/api.ts`), `eventsource-parser`, Zustand store, TypeScript types matching API schemas. (Can start after Step 2, parallel with Steps 3-4.)
6. **Upload page** — file uploader (drag-and-drop), folder path input, progress polling via `GET /api/index-status`, tree view from `GET /api/documents/{id}`.
7. **Chat page** — checklist flow (compute next question client-side from config vs state), message list with auto-scroll, SSE streaming with buffered parser, sources expander, follow-up chips, disabled input during streaming.
8. **Home page + sidebar** — root layout, collapsible sidebar, navigation, document list, session list with `updated_at` ordering, "New Chat" button.
9. **Docker Compose** — frontend + backend + PostgreSQL. Two API URL env vars: `NEXT_PUBLIC_API_URL` (browser, `http://localhost:8000`) and `API_URL` (server-side, `http://backend:8000`).
10. **Integration testing** — full flow: upload docs → verify in DB → checklist → chat with streaming → verify messages persisted → refresh and verify history loads.

## What Gets Deleted

- `streamlit_app.py` — replaced by Next.js home page
- `pages/1_Upload_Docs.py` — replaced by Next.js upload page
- `pages/2_Chat.py` — replaced by Next.js chat page
- `requirements.txt` (root) — moved to `backend/requirements.txt`
- `.streamlit/` — no longer needed

## What Gets Kept (moved to backend/)

- `core/indexer.py` — as-is
- `core/retrieval.py` — as-is
- `core/chat.py` → `core/chat_engine.py` (renamed, minor SSE adaptation)
- `core/checklist.py` — minor refactor (remove session_state dependency)
- `config/checklist_config.json` — as-is
- `lib/PageIndex/` — as-is
- `sample_docs/` — as-is
- `pageindex_cache/` — REMOVED (no file cache; PostgreSQL only; Redis later)
