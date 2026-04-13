"""Onboarding checklist endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.checklist import get_help_content, load_config
from core.document_store import load_indexed_trees
from models.database import get_db
from models.models import ChatSession, ChecklistState as ChecklistStateModel
from schemas.schemas import ChecklistAnswerIn, ChecklistSkipIn, ChecklistStateOut

router = APIRouter(prefix="/api/checklist", tags=["checklist"])


# ── Helpers ──────────────────────────────────────────────────────────


async def _get_or_create_checklist(
    db: AsyncSession, session_id: UUID
) -> ChecklistStateModel:
    """Return the ChecklistState row for *session_id*, creating one if needed.

    Raises 404 if the parent ChatSession does not exist.
    """
    # Verify the chat session exists
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Look up existing checklist state
    result = await db.execute(
        select(ChecklistStateModel).where(
            ChecklistStateModel.session_id == session_id
        )
    )
    checklist = result.scalar_one_or_none()

    if checklist is None:
        checklist = ChecklistStateModel(
            session_id=session_id,
            answers={},
            skipped=False,
        )
        db.add(checklist)
        await db.flush()
        await db.refresh(checklist)

    return checklist


# ── Endpoints ────────────────────────────────────────────────────────


@router.get("/config")
async def get_checklist_config():
    """Return the full checklist configuration."""
    return load_config()


@router.get("/state/{session_id}", response_model=ChecklistStateOut)
async def get_checklist_state(
    session_id: UUID, db: AsyncSession = Depends(get_db)
):
    """Get (or create) checklist state for a session."""
    checklist = await _get_or_create_checklist(db, session_id)
    return checklist


@router.post("/answer", response_model=ChecklistStateOut)
async def answer_question(
    body: ChecklistAnswerIn, db: AsyncSession = Depends(get_db)
):
    """Record a yes/no answer for a checklist question."""
    # Convert bool → string expected by core module
    answer_str = "yes" if body.answer else "no"

    # Validate answer value and question_id against config
    config = load_config()
    valid_ids = {q["id"] for q in config["questions"]}
    if body.question_id not in valid_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid question_id: {body.question_id}",
        )

    checklist = await _get_or_create_checklist(db, body.session_id)

    # Merge the new answer into existing answers (don't replace the whole dict)
    existing_answers = dict(checklist.answers or {})
    existing_answers[body.question_id] = answer_str
    checklist.answers = existing_answers

    await db.flush()
    await db.refresh(checklist)
    return checklist


@router.post("/skip", response_model=ChecklistStateOut)
async def skip_checklist(
    body: ChecklistSkipIn, db: AsyncSession = Depends(get_db)
):
    """Skip the entire checklist for a session."""
    checklist = await _get_or_create_checklist(db, body.session_id)
    checklist.skipped = True

    await db.flush()
    await db.refresh(checklist)
    return checklist


@router.post("/reset", response_model=ChecklistStateOut)
async def reset_checklist(
    body: ChecklistSkipIn, db: AsyncSession = Depends(get_db)
):
    """Reset checklist state — clear all answers and un-skip."""
    checklist = await _get_or_create_checklist(db, body.session_id)
    checklist.answers = {}
    checklist.skipped = False

    await db.flush()
    await db.refresh(checklist)
    return checklist


@router.get("/help/{question_id}")
async def get_help(question_id: str, db: AsyncSession = Depends(get_db)):
    """Return help content for a checklist question (on_no guidance + docs)."""
    config = load_config()

    question = None
    for q in config["questions"]:
        if q["id"] == question_id:
            question = q
            break

    if question is None:
        raise HTTPException(
            status_code=404, detail=f"Question not found: {question_id}"
        )

    indexed_trees = await load_indexed_trees(db)
    return get_help_content(question, indexed_trees)
