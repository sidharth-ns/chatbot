# OnboardBot Backend Migration Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FastAPI backend with PostgreSQL, migrating core logic from the Streamlit app. All endpoints testable with curl before frontend exists.

**Architecture:** FastAPI app with SQLAlchemy ORM + Alembic migrations. Reuses existing `core/indexer.py`, `core/retrieval.py` with minimal changes. New `core/chat_engine.py` (SSE async generator) and `core/document_store.py` (DB bridge). Single async worker.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL 16, Anthropic SDK, litellm, pydantic-settings

**Spec:** `docs/superpowers/specs/2026-04-13-nextjs-fastapi-migration-design.md`

---

## Task 1: Backend Scaffolding

**Files:**
- Create: `backend/main.py`
- Create: `backend/config/__init__.py`
- Create: `backend/config/settings.py`
- Create: `backend/models/__init__.py`
- Create: `backend/models/database.py`
- Create: `backend/models/models.py`
- Create: `backend/schemas/__init__.py`
- Create: `backend/schemas/schemas.py`
- Create: `backend/routers/__init__.py`
- Create: `backend/core/__init__.py`
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Copy: `config/checklist_config.json` → `backend/config/checklist_config.json`
- Copy: `sample_docs/` → `backend/sample_docs/`

- [ ] **Step 1: Create backend directory structure**

```bash
mkdir -p backend/{config,models,schemas,routers,core}
touch backend/{config,models,schemas,routers,core}/__init__.py
```

- [ ] **Step 2: Create requirements.txt**

Write to `backend/requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
sqlalchemy[asyncio]==2.0.35
asyncpg==0.30.0
alembic==1.14.0
pydantic-settings==2.6.0
python-dotenv==1.2.2
anthropic==0.94.0
litellm==1.83.0
python-multipart==0.0.12
```

- [ ] **Step 3: Create config/settings.py**

Write to `backend/config/settings.py`:
```python
import os
from pydantic_settings import BaseSettings

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    pageindex_model: str = "anthropic/claude-haiku-4-5-20251001"
    chat_model: str = "claude-sonnet-4-20250514"
    database_url: str = "postgresql+asyncpg://onboardbot:onboardbot@localhost:5432/onboardbot"
    cors_origins: list[str] = ["http://localhost:3000"]
    max_upload_size_mb: int = 10
    allowed_index_paths: list[str] = [os.path.join(BASE_DIR, "sample_docs")]

    class Config:
        env_file = os.path.join(BASE_DIR, ".env")


settings = Settings()

# Re-export for backward compatibility with core modules
ANTHROPIC_API_KEY = settings.anthropic_api_key
OPENAI_API_KEY = settings.openai_api_key
PAGEINDEX_MODEL = settings.pageindex_model
CHAT_MODEL = settings.chat_model
SAMPLE_DOCS_DIR = os.path.join(BASE_DIR, "sample_docs")
```

- [ ] **Step 4: Create models/database.py**

Write to `backend/models/database.py`:
```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from config.settings import settings


engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
```

- [ ] **Step 5: Create models/models.py**

Write to `backend/models/models.py`:
```python
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, Boolean, ForeignKey, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship
from models.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    doc_name: Mapped[str | None] = mapped_column(String)
    file_hash: Mapped[str] = mapped_column(String, nullable=False)
    tree_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    node_count: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text)
    indexed_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (Index("idx_documents_file_hash", "file_hash"),)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    messages: Mapped[list["Message"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    checklist: Mapped["ChecklistState | None"] = relationship(back_populates="session", cascade="all, delete-orphan", uselist=False)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sources: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    session: Mapped["ChatSession"] = relationship(back_populates="messages")

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_message_role"),
        Index("idx_messages_session_id", "session_id", "created_at"),
    )


class ChecklistState(Base):
    __tablename__ = "checklist_state"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    answers: Mapped[dict] = mapped_column(JSONB, default=dict)
    skipped: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped["ChatSession"] = relationship(back_populates="checklist")
```

- [ ] **Step 6: Create schemas/schemas.py**

Write to `backend/schemas/schemas.py`:
```python
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


# --- Documents ---
class DocumentOut(BaseModel):
    id: UUID
    filename: str
    doc_name: str | None
    node_count: int
    description: str | None
    indexed_at: datetime

    class Config:
        from_attributes = True


class DocumentDetailOut(DocumentOut):
    tree_json: dict
    file_hash: str


class IndexStatusOut(BaseModel):
    running: bool
    progress: int
    total: int
    current_file: str
    error: str | None


class IndexFolderIn(BaseModel):
    folder_path: str


# --- Chat ---
class SessionOut(BaseModel):
    id: UUID
    title: str | None
    created_at: datetime
    updated_at: datetime
    last_message: str | None = None

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: UUID
    role: str
    content: str
    sources: list[dict] | None
    created_at: datetime

    class Config:
        from_attributes = True


class ChatIn(BaseModel):
    session_id: UUID
    message: str


class ChatStopIn(BaseModel):
    session_id: UUID
    stream_id: str


# --- Checklist ---
class ChecklistAnswerIn(BaseModel):
    session_id: UUID
    question_id: str
    answer: str  # "yes" or "no"


class ChecklistSkipIn(BaseModel):
    session_id: UUID


class ChecklistStateOut(BaseModel):
    answers: dict
    skipped: bool

    class Config:
        from_attributes = True
```

- [ ] **Step 7: Create main.py**

Write to `backend/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config.settings import settings
from models.database import engine
from routers import upload, chat, checklist

app = FastAPI(title="OnboardBot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api", tags=["documents"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(checklist.router, prefix="/api", tags=["checklist"])


@app.get("/api/health")
async def health():
    from sqlalchemy import text
    from models.database import async_session
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "error", "db": str(e)}
```

- [ ] **Step 8: Create .env.example**

Write to `backend/.env.example`:
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql+asyncpg://onboardbot:onboardbot@localhost:5432/onboardbot
PAGEINDEX_MODEL=anthropic/claude-haiku-4-5-20251001
CHAT_MODEL=claude-sonnet-4-20250514
```

- [ ] **Step 9: Create stub routers (empty, to be filled in later tasks)**

Write to `backend/routers/upload.py`:
```python
from fastapi import APIRouter

router = APIRouter()
```

Write to `backend/routers/chat.py`:
```python
from fastapi import APIRouter

router = APIRouter()
```

Write to `backend/routers/checklist.py`:
```python
from fastapi import APIRouter

router = APIRouter()
```

- [ ] **Step 10: Setup Alembic**

```bash
cd backend
pip install -r requirements.txt
alembic init alembic
```

Edit `backend/alembic/env.py` — replace the `target_metadata` line:
```python
from models.database import Base
from models.models import Document, ChatSession, Message, ChecklistState
target_metadata = Base.metadata
```

Edit `backend/alembic.ini` — update `sqlalchemy.url`:
```
sqlalchemy.url = postgresql+asyncpg://onboardbot:onboardbot@localhost:5432/onboardbot
```

- [ ] **Step 11: Create initial migration**

```bash
cd backend
alembic revision --autogenerate -m "initial tables"
alembic upgrade head
```

- [ ] **Step 12: Add the updated_at trigger migration**

Create a manual migration `backend/alembic/versions/002_add_updated_at_trigger.py`:
```python
"""add updated_at trigger"""
from alembic import op

revision = "002"
down_revision = None  # will be set by alembic
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
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
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS trg_update_session_on_message ON messages;")
    op.execute("DROP FUNCTION IF EXISTS update_session_timestamp;")
```

Run: `alembic upgrade head`

- [ ] **Step 13: Copy sample_docs and checklist_config.json**

```bash
cp -r sample_docs/ backend/sample_docs/
cp config/checklist_config.json backend/config/checklist_config.json
```

- [ ] **Step 14: Start PostgreSQL via docker-compose (for dev)**

Write to root `docker-compose.dev.yml`:
```yaml
services:
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

```bash
docker-compose -f docker-compose.dev.yml up -d
```

- [ ] **Step 15: Test the scaffolding**

```bash
cd backend
cp .env.example .env
# Edit .env with real ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000
```

Test: `curl http://localhost:8000/api/health`
Expected: `{"status": "ok", "db": "connected"}`

- [ ] **Step 16: Commit**

```bash
git add backend/ docker-compose.dev.yml
git commit -m "feat: backend scaffolding — FastAPI, SQLAlchemy, Alembic, PostgreSQL"
```

---

## Task 2: Migrate Core Modules

**Files:**
- Copy+modify: `core/indexer.py` → `backend/core/indexer.py`
- Copy+modify: `core/retrieval.py` → `backend/core/retrieval.py`
- Copy+modify: `core/checklist.py` → `backend/core/checklist.py`
- Create: `backend/core/document_store.py`
- Create: `backend/core/chat_engine.py`

- [ ] **Step 1: Copy indexer.py and strip file cache**

Copy `core/indexer.py` to `backend/core/indexer.py`.

Remove these functions: `_file_hash`, `_cache_path`, `_load_from_cache`, `_save_to_cache`.

Remove `CACHE_DIR` import from settings.

Update `index_markdown_file` to remove cache logic — just run `md_to_tree` and return the tree:

```python
def index_markdown_file(
    filepath: str,
    model: str = None,
    force_reindex: bool = False,
    progress_callback=None,
) -> dict:
    model = model or PAGEINDEX_MODEL
    filename = os.path.basename(filepath)

    if progress_callback:
        progress_callback(f"Indexing: {filename}...")

    tree = _run_async(
        md_to_tree(
            md_path=filepath,
            if_thinning=False,
            if_add_node_summary="yes",
            summary_token_threshold=500,
            model=model,
            if_add_doc_description="yes",
            if_add_node_text="yes",
            if_add_node_id="yes",
        )
    )

    if progress_callback:
        progress_callback(f"Done: {filename}")

    return tree
```

Keep: `_run_async`, `_run_async_inner`, `has_heading_structure`, `count_nodes`, `scan_directory`, `start_bg_indexing`, `get_bg_status`, `_thread_pool`, PDF mocks, PageIndex auto-clone.

- [ ] **Step 2: Copy retrieval.py**

Copy `core/retrieval.py` to `backend/core/retrieval.py`. No changes needed — imports from `config.settings` will resolve via the re-exports in the new settings.py.

- [ ] **Step 3: Create document_store.py**

Write to `backend/core/document_store.py`:
```python
"""Bridge between PostgreSQL and core modules that expect indexed_trees dicts."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models.models import Document


async def load_indexed_trees(db: AsyncSession) -> dict:
    """Load all indexed documents from DB into the dict format
    that retrieval.py and chat_engine.py expect.

    Returns: {filename: {"tree": tree_dict, "file_hash": str, "indexed_at": str}}
    """
    result = await db.execute(select(Document))
    docs = result.scalars().all()
    return {
        doc.filename: {
            "tree": doc.tree_json,
            "file_hash": doc.file_hash,
            "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else "",
        }
        for doc in docs
    }


async def save_document(db: AsyncSession, filename: str, tree: dict, file_hash: str) -> Document:
    """Save or update a document's tree JSON in the DB after indexing."""
    from core.indexer import count_nodes

    result = await db.execute(select(Document).where(Document.filename == filename))
    existing = result.scalar_one_or_none()

    if existing:
        existing.tree_json = tree
        existing.file_hash = file_hash
        existing.node_count = count_nodes(tree)
        existing.description = tree.get("doc_description", "")
        existing.doc_name = tree.get("doc_name", filename)
        doc = existing
    else:
        doc = Document(
            filename=filename,
            doc_name=tree.get("doc_name", filename),
            file_hash=file_hash,
            tree_json=tree,
            node_count=count_nodes(tree),
            description=tree.get("doc_description", ""),
        )
        db.add(doc)

    await db.commit()
    await db.refresh(doc)
    return doc


async def delete_document(db: AsyncSession, doc_id) -> bool:
    """Delete a document by ID. Returns True if found and deleted."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if doc:
        await db.delete(doc)
        await db.commit()
        return True
    return False
```

- [ ] **Step 4: Refactor checklist.py**

Copy `core/checklist.py` to `backend/core/checklist.py`.

Replace all `session_state` parameters with a Pydantic model. Remove `init_state`. Remove `checklist_step` and `checklist_messages` tracking:

```python
"""Onboarding checklist logic — stateless functions operating on ChecklistState."""

import json
import functools
import os
from typing import Optional
from pydantic import BaseModel
from core.retrieval import search_nodes_by_keywords

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config",
    "checklist_config.json",
)


class ChecklistState(BaseModel):
    answers: dict[str, str] = {}  # question_id -> "yes"|"no"
    skipped: bool = False


@functools.lru_cache(maxsize=1)
def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
    if "questions" not in config or not isinstance(config["questions"], list):
        raise ValueError("checklist_config.json must have a 'questions' list")
    return config


def get_current_question(state: ChecklistState) -> Optional[dict]:
    config = load_config()
    for question in config["questions"]:
        if question["id"] not in state.answers:
            return question
    return None


def get_progress(state: ChecklistState) -> tuple[int, int]:
    config = load_config()
    total = len(config["questions"])
    completed = len(state.answers)
    return completed, total


def is_complete(state: ChecklistState) -> bool:
    if state.skipped:
        return True
    config = load_config()
    return len(state.answers) >= len(config["questions"])


def get_help_content(
    question: dict,
    indexed_trees: Optional[dict] = None,
) -> dict:
    on_no = question.get("on_no", {})
    result = {
        "message": on_no.get("message", "Here's some help:"),
        "command": on_no.get("command"),
        "link": on_no.get("link"),
        "doc_content": None,
    }

    if not result["command"] and not result["link"] and indexed_trees:
        search_terms = question.get("search_terms", [])
        if search_terms:
            matches = search_nodes_by_keywords(search_terms, indexed_trees)
            if matches:
                content_parts = []
                for match in matches[:3]:
                    title = match.get("node_title", "")
                    text = match.get("content", "")
                    if text:
                        content_parts.append(f"**{match['file_name']}** > {title}\n\n{text}")
                if content_parts:
                    result["doc_content"] = "\n\n---\n\n".join(content_parts)

    return result
```

- [ ] **Step 5: Create chat_engine.py (SSE async generator)**

Write to `backend/core/chat_engine.py`:
```python
"""Claude API integration — SSE event generator for streaming chat responses."""

import json
import logging
import uuid
from typing import AsyncGenerator, Optional

import anthropic

from config.settings import ANTHROPIC_API_KEY, CHAT_MODEL
from core.retrieval import search_trees, build_context

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are OnboardBot, a friendly and patient onboarding assistant \
that helps new team members understand a project by answering questions based on \
the project's documentation.

Rules:
1. PRIORITIZE the provided documentation context when answering. Always cite your \
   sources — format as: "According to **ARCHITECTURE.md** > *Deployment* section..."
2. If the documentation context does not contain enough information, you MAY use \
   your general knowledge to answer. In that case, clearly indicate this by saying: \
   "This isn't covered in the indexed docs, but based on my general knowledge..."
3. Be encouraging and welcoming — remember the user is new to the project.
4. Format commands and code in proper markdown code blocks with language hints.
5. Keep answers concise but thorough. Use bullet points for multi-part answers.
6. If multiple docs cover the topic, synthesize information from all of them."""

FAST_MODEL = "claude-haiku-4-5-20251001"

_client: Optional[anthropic.Anthropic] = None
_active_streams: dict[str, bool] = {}  # stream_id -> cancelled


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


async def stream_chat_sse(
    messages: list[dict],
    indexed_trees: Optional[dict] = None,
    model: str = None,
) -> AsyncGenerator[dict, None]:
    """Yield SSE event dicts for a chat response.

    Events: stream_start, search_start, sources, token, done, stopped, error
    """
    model = model or CHAT_MODEL
    client = _get_client()
    stream_id = str(uuid.uuid4())

    _active_streams[stream_id] = False

    yield {"type": "stream_start", "data": {"stream_id": stream_id}}

    # RAG search
    user_query = messages[-1].get("content", "") if messages else ""
    sources = []
    context = ""

    yield {"type": "search_start"}

    if indexed_trees and user_query:
        sources = search_trees(user_query, indexed_trees)
        if sources:
            context = build_context(sources)

    if sources:
        yield {
            "type": "sources",
            "data": [
                {"file_name": s["file_name"], "heading_path": s["heading_path"],
                 "snippet": s.get("content", "")[:200]}
                for s in sources
            ],
        }

    # Build system prompt
    if context:
        system = f"""{SYSTEM_PROMPT}

<retrieved_documentation>
{context}
</retrieved_documentation>

Use the above documentation context to answer the user's question."""
    else:
        system = SYSTEM_PROMPT

    recent = [m for m in messages[-10:] if m.get("content", "").strip()]
    full_response = ""

    try:
        with client.messages.stream(
            model=model,
            max_tokens=2048,
            system=system,
            messages=recent,
        ) as stream:
            for text in stream.text_stream:
                if _active_streams.get(stream_id):
                    # Cancelled
                    yield {"type": "stopped", "data": {"partial_response": full_response}}
                    break
                full_response += text
                yield {"type": "token", "data": text}
            else:
                # Stream completed normally — generate follow-ups
                followups = _generate_followups(user_query, full_response)
                yield {
                    "type": "done",
                    "data": {
                        "full_response": full_response,
                        "sources": sources,
                        "followups": followups,
                    },
                }
    except anthropic.AuthenticationError:
        yield {"type": "error", "data": {"message": "Invalid API key"}}
    except anthropic.RateLimitError:
        yield {"type": "error", "data": {"message": "Rate limit reached. Please wait."}}
    except Exception as e:
        logger.error(f"Stream error: {e}")
        yield {"type": "error", "data": {"message": str(e)[:200]}}
    finally:
        _active_streams.pop(stream_id, None)


def stop_stream(stream_id: str) -> bool:
    """Set cancellation flag for an active stream. Returns True if stream was active."""
    if stream_id in _active_streams:
        _active_streams[stream_id] = True
        return True
    return False


def _generate_followups(question: str, response: str) -> list[str]:
    try:
        client = _get_client()
        resp = client.messages.create(
            model=FAST_MODEL,
            max_tokens=256,
            messages=[
                {"role": "user", "content": question},
                {"role": "assistant", "content": response[:500]},
                {"role": "user", "content": "Suggest 2-3 follow-up questions. Return ONLY a JSON array."},
            ],
            temperature=0.7,
        )
        if not resp.content:
            return []
        text = resp.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1].split("```")[0]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text.strip())
        return [str(q) for q in result if isinstance(q, str) and q.strip()][:3]
    except Exception:
        return []


def generate_starter_questions(indexed_trees: Optional[dict] = None) -> list[str]:
    defaults = [
        "What is this project about?",
        "How do I set up my development environment?",
        "What's the project architecture?",
        "How do I run the tests?",
        "What's the contribution workflow?",
    ]
    if not indexed_trees:
        return defaults

    client = _get_client()
    doc_summaries = []
    for filename, tree_data in indexed_trees.items():
        tree = tree_data.get("tree", tree_data)
        doc_name = tree.get("doc_name", filename)
        desc = tree.get("doc_description", "")
        top_titles = [n.get("title", "") for n in tree.get("structure", [])[:6]]
        doc_summaries.append(f"- {doc_name} ({filename}): {desc or ', '.join(top_titles)}")

    try:
        resp = client.messages.create(
            model=FAST_MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": f"""Based on these docs, generate 6 starter questions for a new team member.
Documents:
{chr(10).join(doc_summaries)}
Return ONLY a JSON array of question strings."""}],
            temperature=0.7,
        )
        if not resp.content:
            return defaults
        text = resp.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1].split("```")[0]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text.strip())
        return [str(q) for q in result if isinstance(q, str)][:8] or defaults
    except Exception:
        return defaults
```

- [ ] **Step 6: Test imports**

```bash
cd backend
python -c "
from config.settings import settings, ANTHROPIC_API_KEY, CHAT_MODEL, PAGEINDEX_MODEL
print(f'Settings OK: {CHAT_MODEL}')
from models.models import Document, ChatSession, Message, ChecklistState
print('Models OK')
from schemas.schemas import ChatIn, DocumentOut, SessionOut
print('Schemas OK')
from core.checklist import load_config, ChecklistState as CS
print(f'Checklist OK: {len(load_config()[\"questions\"])} questions')
print('All imports OK')
"
```

Expected: All imports succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/core/ backend/config/checklist_config.json
git commit -m "feat: migrate core modules — indexer, retrieval, chat_engine, checklist, document_store"
```

---

## Task 3: Upload & Document API

**Files:**
- Modify: `backend/routers/upload.py`

- [ ] **Step 1: Implement upload router**

Write to `backend/routers/upload.py`:
```python
import os
import hashlib
import tempfile
import shutil
from uuid import UUID

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config.settings import settings, SAMPLE_DOCS_DIR
from models.database import get_db
from models.models import Document
from schemas.schemas import DocumentOut, DocumentDetailOut, IndexStatusOut, IndexFolderIn
from core.indexer import (
    index_markdown_file, scan_directory, has_heading_structure,
    get_bg_status, start_bg_indexing, count_nodes,
)
from core.document_store import save_document, load_indexed_trees, delete_document

router = APIRouter()

# Track temp dirs for cleanup
_temp_dirs: list[str] = []


@router.post("/upload", response_model=IndexStatusOut)
async def upload_files(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload .md files and start background indexing."""
    temp_dir = tempfile.mkdtemp(prefix="onboardbot_upload_")
    _temp_dirs.append(temp_dir)
    filepaths = []

    for file in files:
        if not file.filename or not file.filename.endswith((".md", ".markdown")):
            continue
        if file.size and file.size > settings.max_upload_size_mb * 1024 * 1024:
            raise HTTPException(400, f"{file.filename} exceeds {settings.max_upload_size_mb}MB limit")

        content = await file.read()
        dest = os.path.join(temp_dir, file.filename)
        with open(dest, "wb") as f:
            f.write(content)
        filepaths.append(dest)

    if not filepaths:
        raise HTTPException(400, "No valid .md files uploaded")

    start_bg_indexing(filepaths)
    status = get_bg_status()
    return IndexStatusOut(**status)


@router.post("/index-folder", response_model=IndexStatusOut)
async def index_folder(body: IndexFolderIn):
    """Scan a local folder for .md files and start indexing."""
    folder = os.path.realpath(body.folder_path)

    # Security: validate against allowed paths
    allowed = any(folder.startswith(os.path.realpath(p)) for p in settings.allowed_index_paths)
    if not allowed:
        raise HTTPException(403, "Folder path not in allowed paths")

    if not os.path.isdir(folder):
        raise HTTPException(404, "Directory not found")

    md_files = scan_directory(folder)
    if not md_files:
        raise HTTPException(404, "No .md files found")

    start_bg_indexing(md_files)
    return IndexStatusOut(**get_bg_status())


@router.get("/index-status", response_model=IndexStatusOut)
async def index_status(db: AsyncSession = Depends(get_db)):
    """Poll background indexing progress. Saves completed results to DB."""
    status = get_bg_status()

    # If complete, save results to DB
    if status["complete"] and status["results"]:
        for filename, result in status["results"].items():
            tree = result if isinstance(result, dict) and "structure" in result else result.get("tree", result)
            file_hash = hashlib.sha256(str(tree).encode()).hexdigest()[:32]
            await save_document(db, filename, tree, file_hash)

        # Clear bg state
        from core.indexer import _bg_lock, _bg_indexing
        with _bg_lock:
            _bg_indexing["results"] = {}
            _bg_indexing["complete"] = False

        # Cleanup temp dirs
        for td in _temp_dirs:
            shutil.rmtree(td, ignore_errors=True)
        _temp_dirs.clear()

    return IndexStatusOut(**get_bg_status())


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).order_by(Document.indexed_at.desc()))
    return result.scalars().all()


@router.get("/documents/{doc_id}", response_model=DocumentDetailOut)
async def get_document(doc_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


@router.delete("/documents/{doc_id}")
async def remove_document(doc_id: UUID, db: AsyncSession = Depends(get_db)):
    deleted = await delete_document(db, doc_id)
    if not deleted:
        raise HTTPException(404, "Document not found")
    return {"status": "deleted"}


@router.post("/documents/reindex", response_model=IndexStatusOut)
async def reindex_all(db: AsyncSession = Depends(get_db)):
    """Re-index all documents from sample_docs."""
    md_files = scan_directory(SAMPLE_DOCS_DIR)
    if not md_files:
        raise HTTPException(404, "No sample docs found")
    start_bg_indexing(md_files, force_reindex=True)
    return IndexStatusOut(**get_bg_status())
```

- [ ] **Step 2: Test upload API with curl**

```bash
# Start server
cd backend && uvicorn main:app --reload --port 8000

# Upload a file
curl -X POST http://localhost:8000/api/upload \
  -F "files=@sample_docs/README.md"

# Check progress
curl http://localhost:8000/api/index-status

# List documents (after indexing completes)
curl http://localhost:8000/api/documents
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/upload.py
git commit -m "feat: upload and document API — file upload, indexing, CRUD"
```

---

## Task 4: Chat API with SSE Streaming

**Files:**
- Modify: `backend/routers/chat.py`

- [ ] **Step 1: Implement chat router**

Write to `backend/routers/chat.py`:
```python
import json
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models.database import get_db
from models.models import ChatSession, Message
from schemas.schemas import SessionOut, MessageOut, ChatIn, ChatStopIn
from core.chat_engine import stream_chat_sse, stop_stream, generate_starter_questions
from core.document_store import load_indexed_trees

router = APIRouter()


@router.post("/chat/sessions", response_model=SessionOut)
async def create_session(db: AsyncSession = Depends(get_db)):
    session = ChatSession()
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/chat/sessions", response_model=list[SessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatSession).order_by(ChatSession.updated_at.desc())
    )
    sessions = result.scalars().all()
    out = []
    for s in sessions:
        # Get last message preview
        msg_result = await db.execute(
            select(Message.content)
            .where(Message.session_id == s.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = msg_result.scalar_one_or_none()
        out.append(SessionOut(
            id=s.id,
            title=s.title,
            created_at=s.created_at,
            updated_at=s.updated_at,
            last_message=last_msg[:100] if last_msg else None,
        ))
    return out


@router.get("/chat/sessions/{session_id}", response_model=list[MessageOut])
async def get_session_messages(session_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    messages = result.scalars().all()
    if not messages:
        # Check session exists
        sess = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        if not sess.scalar_one_or_none():
            raise HTTPException(404, "Session not found")
    return messages


@router.delete("/chat/sessions/{session_id}")
async def delete_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    await db.delete(session)
    await db.commit()
    return {"status": "deleted"}


@router.post("/chat")
async def chat_stream(body: ChatIn, db: AsyncSession = Depends(get_db)):
    """Stream a chat response via SSE."""
    # Verify session exists
    result = await db.execute(select(ChatSession).where(ChatSession.id == body.session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    # Save user message
    user_msg = Message(
        session_id=body.session_id,
        role="user",
        content=body.message,
    )
    db.add(user_msg)
    await db.commit()

    # Auto-generate session title from first message
    if not session.title:
        session.title = body.message[:50]
        await db.commit()

    # Load indexed trees
    indexed_trees = await load_indexed_trees(db)

    # Build message history
    msg_result = await db.execute(
        select(Message)
        .where(Message.session_id == body.session_id)
        .order_by(Message.created_at)
    )
    history = [
        {"role": m.role, "content": m.content}
        for m in msg_result.scalars().all()
    ]

    async def event_generator():
        full_response = ""
        sources = []

        async for event in stream_chat_sse(history, indexed_trees):
            event_type = event.get("type")

            if event_type == "token":
                full_response += event["data"]
            elif event_type == "done":
                full_response = event["data"]["full_response"]
                sources = event["data"].get("sources", [])
            elif event_type == "stopped":
                full_response = event["data"]["partial_response"]

            yield f"data: {json.dumps(event)}\n\n"

            # Save assistant message after done/stopped
            if event_type in ("done", "stopped"):
                assistant_msg = Message(
                    session_id=body.session_id,
                    role="assistant",
                    content=full_response,
                    sources=[
                        {"file_name": s.get("file_name"), "heading_path": s.get("heading_path"),
                         "snippet": s.get("content", "")[:200]}
                        for s in sources
                    ] if sources else None,
                )
                db.add(assistant_msg)
                await db.commit()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat/stop")
async def stop_chat(body: ChatStopIn):
    """Stop an active streaming response."""
    stopped = stop_stream(body.stream_id)
    if not stopped:
        raise HTTPException(404, "Stream not found or already finished")
    return {"status": "stopped"}


@router.get("/chat/starter-questions")
async def starter_questions(db: AsyncSession = Depends(get_db)):
    indexed_trees = await load_indexed_trees(db)
    questions = generate_starter_questions(indexed_trees)
    return {"questions": questions}
```

- [ ] **Step 2: Test chat API with curl**

```bash
# Create a session
curl -X POST http://localhost:8000/api/chat/sessions

# Send a message (replace SESSION_ID)
curl -N -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "SESSION_ID", "message": "What is the tech stack?"}'

# List sessions
curl http://localhost:8000/api/chat/sessions

# Get messages
curl http://localhost:8000/api/chat/sessions/SESSION_ID
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/chat.py
git commit -m "feat: chat API — sessions, SSE streaming, stop, starter questions"
```

---

## Task 5: Checklist API

**Files:**
- Modify: `backend/routers/checklist.py`

- [ ] **Step 1: Implement checklist router**

Write to `backend/routers/checklist.py`:
```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models.database import get_db
from models.models import ChecklistState as ChecklistStateModel, ChatSession
from schemas.schemas import ChecklistAnswerIn, ChecklistSkipIn, ChecklistStateOut
from core.checklist import load_config, ChecklistState, get_help_content, is_complete, get_current_question, get_progress
from core.document_store import load_indexed_trees

router = APIRouter()


async def _get_or_create_checklist(db: AsyncSession, session_id: UUID) -> ChecklistStateModel:
    result = await db.execute(
        select(ChecklistStateModel).where(ChecklistStateModel.session_id == session_id)
    )
    state = result.scalar_one_or_none()
    if not state:
        # Verify session exists
        sess = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        if not sess.scalar_one_or_none():
            raise HTTPException(404, "Session not found")
        state = ChecklistStateModel(session_id=session_id, answers={}, skipped=False)
        db.add(state)
        await db.commit()
        await db.refresh(state)
    return state


@router.get("/checklist/config")
async def get_checklist_config():
    config = load_config()
    return config


@router.get("/checklist/state/{session_id}", response_model=ChecklistStateOut)
async def get_checklist_state(session_id: UUID, db: AsyncSession = Depends(get_db)):
    state = await _get_or_create_checklist(db, session_id)
    return state


@router.post("/checklist/answer", response_model=ChecklistStateOut)
async def answer_question(body: ChecklistAnswerIn, db: AsyncSession = Depends(get_db)):
    if body.answer not in ("yes", "no"):
        raise HTTPException(400, "Answer must be 'yes' or 'no'")

    config = load_config()
    valid_ids = {q["id"] for q in config["questions"]}
    if body.question_id not in valid_ids:
        raise HTTPException(400, f"Invalid question_id: {body.question_id}")

    state = await _get_or_create_checklist(db, body.session_id)
    answers = dict(state.answers)
    answers[body.question_id] = body.answer
    state.answers = answers
    await db.commit()
    await db.refresh(state)
    return state


@router.post("/checklist/skip", response_model=ChecklistStateOut)
async def skip_checklist(body: ChecklistSkipIn, db: AsyncSession = Depends(get_db)):
    state = await _get_or_create_checklist(db, body.session_id)
    state.skipped = True
    await db.commit()
    await db.refresh(state)
    return state


@router.post("/checklist/reset", response_model=ChecklistStateOut)
async def reset_checklist(body: ChecklistSkipIn, db: AsyncSession = Depends(get_db)):
    state = await _get_or_create_checklist(db, body.session_id)
    state.answers = {}
    state.skipped = False
    await db.commit()
    await db.refresh(state)
    return state


@router.get("/checklist/help/{question_id}")
async def get_help(question_id: str, db: AsyncSession = Depends(get_db)):
    config = load_config()
    question = next((q for q in config["questions"] if q["id"] == question_id), None)
    if not question:
        raise HTTPException(404, f"Question not found: {question_id}")

    indexed_trees = await load_indexed_trees(db)
    help_content = get_help_content(question, indexed_trees)
    return help_content
```

- [ ] **Step 2: Test checklist API with curl**

```bash
# Get config
curl http://localhost:8000/api/checklist/config

# Get state (creates if needed)
curl http://localhost:8000/api/checklist/state/SESSION_ID

# Answer a question
curl -X POST http://localhost:8000/api/checklist/answer \
  -H "Content-Type: application/json" \
  -d '{"session_id": "SESSION_ID", "question_id": "repo_clone", "answer": "yes"}'

# Get help
curl http://localhost:8000/api/checklist/help/dependencies

# Skip
curl -X POST http://localhost:8000/api/checklist/skip \
  -H "Content-Type: application/json" \
  -d '{"session_id": "SESSION_ID"}'
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/checklist.py
git commit -m "feat: checklist API — config, state, answers, help, skip, reset"
```

---

## Task 6: Clone PageIndex + Integration Test

- [ ] **Step 1: Clone PageIndex into backend**

```bash
git clone https://github.com/VectifyAI/PageIndex.git backend/lib/PageIndex
```

- [ ] **Step 2: Create backend .env with real API key**

```bash
cd backend
cp .env.example .env
# Edit with real ANTHROPIC_API_KEY and DATABASE_URL
```

- [ ] **Step 3: Run full integration test**

```bash
cd backend

# 1. Start PostgreSQL
docker-compose -f ../docker-compose.dev.yml up -d

# 2. Run migrations
alembic upgrade head

# 3. Start server
uvicorn main:app --reload --port 8000 &

# 4. Health check
curl http://localhost:8000/api/health

# 5. Upload sample docs
curl -X POST http://localhost:8000/api/upload \
  -F "files=@sample_docs/README.md" \
  -F "files=@sample_docs/SETUP.md"

# 6. Poll until complete
sleep 15
curl http://localhost:8000/api/index-status

# 7. List documents
curl http://localhost:8000/api/documents

# 8. Create chat session
curl -X POST http://localhost:8000/api/chat/sessions

# 9. Chat (replace SESSION_ID)
curl -N -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "SESSION_ID", "message": "What is the tech stack?"}'

# 10. Starter questions
curl http://localhost:8000/api/chat/starter-questions

# 11. Checklist
curl http://localhost:8000/api/checklist/config
curl http://localhost:8000/api/checklist/help/dependencies
```

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "feat: backend complete — all endpoints working, integration tested"
```

---

## Summary

| Task | What | Files | Depends On |
|------|------|-------|------------|
| 1 | Backend scaffolding | main.py, settings, models, schemas, alembic | - |
| 2 | Core module migration | indexer, retrieval, chat_engine, checklist, document_store | Task 1 |
| 3 | Upload/Document API | routers/upload.py | Task 2 |
| 4 | Chat API with SSE | routers/chat.py | Task 2 |
| 5 | Checklist API | routers/checklist.py | Task 2 |
| 6 | Integration test | end-to-end verification | Tasks 3-5 |
