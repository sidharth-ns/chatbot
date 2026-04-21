"""
Pydantic models for API request / response bodies.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# ── Documents ──


class DocumentOut(BaseModel):
    id: UUID
    filename: str
    doc_name: str
    node_count: int | None = None
    description: str | None = None
    indexed_at: datetime

    model_config = {"from_attributes": True}


class DocumentDetailOut(DocumentOut):
    file_hash: str
    tree_json: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class IndexStatusOut(BaseModel):
    indexed: int
    pending: int
    current_file: str = ""
    documents: list[DocumentOut]


class IndexFolderIn(BaseModel):
    folder_path: str | None = None


# ── Chat sessions ──


class SessionOut(BaseModel):
    id: UUID
    title: str | None = None
    created_at: datetime
    updated_at: datetime
    last_message: str | None = None

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: UUID
    session_id: UUID
    role: str
    content: str
    sources: list[dict[str, Any]] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatIn(BaseModel):
    message: str = Field(..., min_length=1)
    session_id: UUID | None = None


class ChatStopIn(BaseModel):
    session_id: UUID


# ── Checklist ──


class ChecklistAnswerIn(BaseModel):
    session_id: UUID
    question_id: str
    answer: bool


class ChecklistSkipIn(BaseModel):
    session_id: UUID


class ChecklistStateOut(BaseModel):
    id: UUID
    session_id: UUID
    answers: dict[str, Any] | None = None
    skipped: bool

    model_config = {"from_attributes": True}
