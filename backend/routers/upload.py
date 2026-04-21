"""Upload & document-indexing endpoints."""

import hashlib
import json
import logging
import os
import shutil
import tempfile
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings, SAMPLE_DOCS_DIR
from core.document_store import delete_document, save_document
from core.indexer import get_bg_status, scan_directory, start_bg_indexing
from models.database import get_db
from models.models import Document
from schemas.schemas import (
    DocumentDetailOut,
    DocumentOut,
    IndexFolderIn,
    IndexStatusOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Track temp directories created for uploads so we can clean them up
_temp_dirs: list[str] = []


def _file_hash_from_tree(tree: dict) -> str:
    """Compute a deterministic hash from a tree dict."""
    return hashlib.sha256(
        json.dumps(tree, sort_keys=True).encode()
    ).hexdigest()[:32]


# ── 1. POST /upload ──


@router.post("/upload", response_model=IndexStatusOut)
async def upload_files(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Accept multiple multipart .md file uploads, validate, and start background indexing."""
    tmp_dir = tempfile.mkdtemp(prefix="onboardbot_upload_")
    _temp_dirs.append(tmp_dir)
    filepaths = []

    for file in files:
        # Validate file extension
        if not file.filename or not file.filename.endswith((".md", ".markdown")):
            continue

        # Read content and validate size
        content = await file.read()
        max_bytes = settings.max_upload_size_mb * 1024 * 1024
        if len(content) > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"{file.filename} exceeds maximum size of {settings.max_upload_size_mb} MB.",
            )

        filepath = os.path.join(tmp_dir, file.filename)
        with open(filepath, "wb") as f:
            f.write(content)
        filepaths.append(filepath)

    if not filepaths:
        raise HTTPException(status_code=400, detail="No valid .md files uploaded.")

    # Start background indexing for ALL files in one batch
    start_bg_indexing(filepaths)

    # Return current status
    status = get_bg_status()
    docs = await _fetch_all_documents(db)

    return IndexStatusOut(
        indexed=len(docs),
        pending=status["total"] - status["progress"],
        documents=docs,
    )


# ── 2. POST /index-folder ──


@router.post("/index-folder", response_model=IndexStatusOut)
async def index_folder(
    body: IndexFolderIn,
    db: AsyncSession = Depends(get_db),
):
    """Validate a folder path, scan for .md files, and start background indexing."""
    folder_path = body.folder_path

    # Default to sample docs if no path provided
    if not folder_path:
        folder_path = SAMPLE_DOCS_DIR

    # Resolve to absolute path
    folder_path = os.path.abspath(folder_path)

    # Validate against allowed paths (if configured)
    if settings.allowed_index_paths:
        allowed = False
        for allowed_path in settings.allowed_index_paths:
            abs_allowed = os.path.abspath(allowed_path)
            if folder_path == abs_allowed or folder_path.startswith(abs_allowed + os.sep):
                allowed = True
                break
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Path not in allowed index paths: {folder_path}",
            )

    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail=f"Directory not found: {folder_path}")

    # Scan for markdown files
    md_files = scan_directory(folder_path)
    if not md_files:
        raise HTTPException(status_code=400, detail="No .md files found in directory.")

    # Start background indexing
    start_bg_indexing(md_files)

    status = get_bg_status()
    docs = await _fetch_all_documents(db)

    return IndexStatusOut(
        indexed=len(docs),
        pending=status["total"] - status["progress"],
        documents=docs,
    )


# ── 3. GET /index-status ──


@router.get("/index-status", response_model=IndexStatusOut)
async def index_status(db: AsyncSession = Depends(get_db)):
    """Poll background indexing progress. Save results to DB when complete."""
    status = get_bg_status()

    # When indexing is complete and there are results, persist them
    if status["complete"] and status["results"]:
        for filename, result in status["results"].items():
            tree = result["tree"]
            file_hash = _file_hash_from_tree(tree)
            try:
                await save_document(db, filename=filename, tree=tree, file_hash=file_hash)
            except Exception:
                logger.exception("Failed to save document %s", filename)

        # Clean up background state by re-triggering a no-op
        # (the bg state resets on next start_bg_indexing call)
        # Instead, manually reset via the module-level dict
        from core.indexer import _bg_indexing, _bg_lock

        with _bg_lock:
            _bg_indexing["results"] = {}
            _bg_indexing["complete"] = False
            _bg_indexing["progress"] = 0
            _bg_indexing["total"] = 0
            _bg_indexing["current_file"] = ""
            _bg_indexing["error"] = None

        # Clean up temp directories
        for tmp_dir in _temp_dirs:
            try:
                if os.path.isdir(tmp_dir):
                    shutil.rmtree(tmp_dir)
            except Exception:
                logger.warning("Failed to clean up temp dir: %s", tmp_dir)
        _temp_dirs.clear()

    docs = await _fetch_all_documents(db)

    return IndexStatusOut(
        indexed=status["progress"],
        pending=max(0, status["total"] - status["progress"]),
        current_file=status.get("current_file", ""),
        documents=docs,
    )


# ── 4. GET /documents ──


@router.get("", response_model=list[DocumentOut])
async def list_documents(db: AsyncSession = Depends(get_db)):
    """List all indexed documents."""
    return await _fetch_all_documents(db)


# ── 5. GET /documents/{doc_id} ──


@router.get("/{doc_id}", response_model=DocumentDetailOut)
async def get_document(doc_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a single document with its full tree."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


# ── 6. DELETE /documents/{doc_id} ──


@router.delete("/{doc_id}")
async def remove_document(doc_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a document by ID."""
    deleted = await delete_document(db, doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"detail": "Document deleted."}


# ── 7. POST /documents/reindex ──


@router.post("/reindex", response_model=IndexStatusOut)
async def reindex_sample_docs(db: AsyncSession = Depends(get_db)):
    """Re-index all sample documentation files."""
    sample_dir = SAMPLE_DOCS_DIR

    if not os.path.isdir(sample_dir):
        raise HTTPException(
            status_code=404, detail=f"Sample docs directory not found: {sample_dir}"
        )

    md_files = scan_directory(sample_dir)
    if not md_files:
        raise HTTPException(status_code=400, detail="No .md files found in sample docs.")

    start_bg_indexing(md_files)

    status = get_bg_status()
    docs = await _fetch_all_documents(db)

    return IndexStatusOut(
        indexed=len(docs),
        pending=status["total"] - status["progress"],
        documents=docs,
    )


# ── Helpers ──


async def _fetch_all_documents(db: AsyncSession) -> list[Document]:
    """Fetch all documents from the database, ordered by indexed_at descending."""
    result = await db.execute(
        select(Document).order_by(Document.indexed_at.desc())
    )
    return list(result.scalars().all())
