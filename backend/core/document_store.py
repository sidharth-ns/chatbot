"""
Bridge between the database and core indexing modules.

Provides async CRUD operations for Document records, converting
between SQLAlchemy models and the dict format expected by
retrieval / chat modules.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.models import Document
from core.indexer import count_nodes

logger = logging.getLogger(__name__)


async def load_indexed_trees(db: AsyncSession) -> dict:
    """
    Query all Documents from the DB and return them in the format
    expected by retrieval and chat modules:

        {filename: {"tree": tree_dict, "file_hash": str, "indexed_at": str}}
    """
    result = await db.execute(select(Document))
    documents = result.scalars().all()

    trees = {}
    for doc in documents:
        trees[doc.filename] = {
            "tree": doc.tree_json or {},
            "file_hash": doc.file_hash,
            "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else "",
        }
    return trees


async def save_document(
    db: AsyncSession,
    filename: str,
    tree: dict,
    file_hash: str,
) -> Document:
    """
    Upsert a document in the database.

    If a Document with the same filename already exists, it is updated.
    Otherwise a new row is created.

    Returns the persisted Document instance.
    """
    # Check for existing document by filename
    result = await db.execute(
        select(Document).where(Document.filename == filename)
    )
    doc = result.scalar_one_or_none()

    node_count = count_nodes(tree)
    doc_name = tree.get("doc_name", filename)
    description = tree.get("doc_description", "")
    indexed_at = datetime.now(timezone.utc)

    if doc is not None:
        # Update existing
        doc.tree_json = tree
        doc.file_hash = file_hash
        doc.node_count = node_count
        doc.doc_name = doc_name
        doc.description = description
        doc.indexed_at = indexed_at
    else:
        # Create new
        doc = Document(
            filename=filename,
            doc_name=doc_name,
            file_hash=file_hash,
            tree_json=tree,
            node_count=node_count,
            description=description,
            indexed_at=indexed_at,
        )
        db.add(doc)

    await db.flush()
    await db.refresh(doc)
    return doc


async def delete_document(db: AsyncSession, doc_id) -> bool:
    """
    Delete a document by its primary key ID.

    Returns True if a document was deleted, False if not found.
    """
    result = await db.execute(
        select(Document).where(Document.id == doc_id)
    )
    doc = result.scalar_one_or_none()

    if doc is None:
        return False

    await db.delete(doc)
    await db.flush()
    return True
