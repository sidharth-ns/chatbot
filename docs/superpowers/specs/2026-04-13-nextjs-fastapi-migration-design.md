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
│   │   ├── chat_engine.py         # Claude integration (renamed from chat.py)
│   │   └── checklist.py           # Checklist logic (minor refactor)
│   ├── models/
│   │   ├── database.py            # SQLAlchemy engine + session
│   │   └── models.py              # ORM models
│   ├── schemas/
│   │   └── schemas.py             # Pydantic request/response models
│   ├── config/
│   │   ├── settings.py            # pydantic-settings based config
│   │   └── checklist_config.json  # Checklist questions
│   ├── lib/PageIndex/             # Cloned PageIndex library
│   ├── pageindex_cache/           # File-based tree cache
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
| `POST` | `/api/chat` | Send a message. Streams response via SSE. Body: `{session_id, message}`. |
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
- `search_start` — retrieval phase started (show spinner)
- `sources` — retrieved nodes (display in sources panel)
- `token` — streaming text chunk (append to message)
- `done` — response complete (show follow-ups, save to DB)
- `error` — error occurred (show error message)

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

- **PostgreSQL** is the canonical store for tree JSON (`documents.tree_json`).
- **`pageindex_cache/`** is a performance optimization for the indexer (avoids re-running LLM calls). After indexing, the tree is written to both cache and DB.
- **Retrieval reads from DB** (loaded into memory on startup or per-request), not from cache files.

### Core Module Reuse

| Module | Changes Needed |
|--------|---------------|
| `core/indexer.py` | Update `from config.settings import ...` to use settings instance. Path resolution works as-is (`_base_dir` resolves to `backend/`). |
| `core/retrieval.py` | Update `from config.settings import ...` to use settings instance. |
| `core/chat_engine.py` | Rename from `chat.py`. Update settings imports. Replace generator with SSE event yielder. Remove background chat (SSE handles streaming natively). |
| `core/checklist.py` | Replace `session_state` parameter with `ChecklistState` Pydantic model. Remove `init_state()`. Keep `load_config()`, `get_help_content()`. |
| `config/settings.py` | Switch to `pydantic-settings`. Remove Streamlit secrets fallback. Re-export constants for backward compatibility. |

### Configuration (pydantic-settings)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    anthropic_api_key: str
    openai_api_key: str = ""
    pageindex_model: str = "anthropic/claude-haiku-4-5-20251001"
    chat_model: str = "claude-sonnet-4-20250514"
    database_url: str = "postgresql+asyncpg://onboardbot:onboardbot@localhost:5432/onboardbot"
    cors_origins: list[str] = ["http://localhost:3000"]
    max_upload_size_mb: int = 10
    
    class Config:
        env_file = ".env"

# Re-export as module-level constants for backward compatibility with core modules
settings = Settings()
ANTHROPIC_API_KEY = settings.anthropic_api_key
OPENAI_API_KEY = settings.openai_api_key
PAGEINDEX_MODEL = settings.pageindex_model
CHAT_MODEL = settings.chat_model
CACHE_DIR = os.path.join(BASE_DIR, "pageindex_cache")
SAMPLE_DOCS_DIR = os.path.join(BASE_DIR, "sample_docs")
```

### Python Package Structure

`backend/` is the Python package root. Set via `PYTHONPATH=/app` in Docker or run from the `backend/` directory. The `from config.settings import ...` imports in core modules resolve relative to `backend/`.

### Authentication

No authentication for now. This is a single-user internal tool. All endpoints are open. Defer auth to a future iteration. Documented here so implementers do not add implicit user-scoping.

### Single Worker Constraint

Background indexing uses process-global state (`_bg_indexing` dict). Run FastAPI with `--workers 1` (single process). If multi-worker is needed later, move indexing state to Redis or PostgreSQL.

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
      - ./backend/pageindex_cache:/app/pageindex_cache
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

1. **Backend scaffolding** — FastAPI app, pydantic-settings, DB models, Alembic migrations, CORS middleware, health endpoint. Run with `--workers 1`.
2. **Upload/indexing API** — file upload (max 10MB), background indexing, document CRUD. Validate folder paths against allowed prefixes.
3. **Chat API** — session management, SSE streaming with proper event protocol, message persistence, `updated_at` trigger.
4. **Checklist API** — config, state, help content endpoints.
5. **Frontend scaffolding** — Next.js 14, Tailwind, shadcn/ui, API client, eventsource-parser, Zustand store. (Can start after Step 2, parallel with Steps 3-4.)
6. **Upload page** — file uploader, progress polling, tree view.
7. **Chat page** — checklist flow, message list, SSE streaming with buffered parser, sources expander.
8. **Home page + sidebar** — layout, navigation, session list, document status.
9. **Docker Compose** — frontend + backend + PostgreSQL. Split `NEXT_PUBLIC_API_URL` (browser) and `API_URL` (server-side).
10. **Integration testing** — end-to-end flow verification.

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
- `pageindex_cache/` — as-is
- `sample_docs/` — as-is
