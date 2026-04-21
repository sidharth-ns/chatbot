"""Chat / session endpoints with SSE streaming."""

import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.chat_engine import generate_starter_questions, stop_stream, stream_chat_sse
from core.document_store import load_indexed_trees
from models.database import async_session, get_db
from models.models import ChatSession, Message
from schemas.schemas import ChatIn, ChatStopIn, MessageOut, SessionOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

# Map session_id -> active stream_id so the stop endpoint can look it up
_session_streams: dict[UUID, str] = {}
# Track accumulated response per session for saving on abort/stop
_session_responses: dict[UUID, dict] = {}  # {session_id: {"text": str, "sources": list|None}}


# ── Sessions ──


@router.post("/sessions", response_model=SessionOut)
async def create_session(db: AsyncSession = Depends(get_db)):
    """Create a new chat session."""
    session = ChatSession()
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    """List all sessions ordered by updated_at desc, with last_message preview."""
    result = await db.execute(
        select(ChatSession).order_by(ChatSession.updated_at.desc())
    )
    sessions = result.scalars().all()

    out = []
    for s in sessions:
        # Fetch last message for preview
        msg_result = await db.execute(
            select(Message)
            .where(Message.session_id == s.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = msg_result.scalar_one_or_none()

        session_out = SessionOut.model_validate(s)
        if last_msg:
            session_out.last_message = last_msg.content[:100]
        out.append(session_out)

    return out


@router.get("/sessions/{session_id}", response_model=list[MessageOut])
async def get_session_messages(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get all messages for a session ordered by created_at."""
    # Verify session exists
    session_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    if session_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc())
    )
    return result.scalars().all()


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete session and cascade messages."""
    session_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Messages cascade via FK ondelete, but explicit delete is safer with async
    await db.execute(
        delete(Message).where(Message.session_id == session_id)
    )
    await db.delete(session)
    await db.flush()
    return {"status": "deleted"}


# ── Chat (SSE streaming) ──


@router.post("")
async def chat(body: ChatIn, db: AsyncSession = Depends(get_db)):
    """
    Main chat endpoint. Saves user message, streams assistant response via SSE,
    then saves assistant message with sources after streaming completes.
    """
    # Resolve or create session
    if body.session_id:
        session_result = await db.execute(
            select(ChatSession).where(ChatSession.id == body.session_id)
        )
        session = session_result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
    else:
        session = ChatSession()
        db.add(session)
        await db.flush()
        await db.refresh(session)

    # Auto-set session title from first user message
    if not session.title:
        session.title = body.message[:50]
        await db.flush()

    # Save user message
    user_msg = Message(
        session_id=session.id,
        role="user",
        content=body.message,
    )
    db.add(user_msg)
    await db.flush()
    await db.commit()

    # Build message history from DB
    msg_result = await db.execute(
        select(Message)
        .where(Message.session_id == session.id)
        .order_by(Message.created_at.asc())
    )
    db_messages = msg_result.scalars().all()
    messages = [
        {"role": m.role, "content": m.content}
        for m in db_messages
    ]

    # Load indexed trees for RAG
    indexed_trees = await load_indexed_trees(db)

    # Capture session_id for the generator closure
    sid = session.id

    async def event_generator():
        """Yield SSE events and save assistant response when done."""
        # Open a dedicated DB session for the generator — the request-scoped
        # session from get_db will be closed by the time streaming finishes.
        async with async_session() as gen_db:
            full_response = ""
            sources = None
            _session_responses[sid] = {"text": "", "sources": None}

            try:
                async for event in stream_chat_sse(messages, indexed_trees):
                    event_type = event.get("type")

                    # Track stream_id so the stop endpoint can find it
                    if event_type == "stream_start":
                        stream_id = event["data"]["stream_id"]
                        _session_streams[sid] = stream_id

                    # Accumulate response on EVERY token (so partial is always available)
                    elif event_type == "token":
                        full_response += event.get("data", "")
                        # Update shared dict so stop endpoint can save partial
                        _session_responses[sid] = {"text": full_response, "sources": sources}

                    elif event_type == "sources":
                        sources = event.get("data")
                        _session_responses[sid] = {"text": full_response, "sources": sources}

                    elif event_type == "done":
                        data = event.get("data", {})
                        full_response = data.get("full_response", full_response)
                        sources = data.get("sources", sources)

                    elif event_type == "stopped":
                        data = event.get("data", {})
                        full_response = data.get("partial_response", full_response)

                    yield f"data: {json.dumps(event)}\n\n"

            except (asyncio.CancelledError, GeneratorExit):
                # Client disconnected — this is normal for stop/abort
                logger.info(f"Stream cancelled for session {sid} (client disconnect)")
            except Exception as e:
                logger.error(f"SSE stream error for session {sid}: {e}")
                error_event = {"type": "error", "data": {"message": str(e)}}
                yield f"data: {json.dumps(error_event)}\n\n"

            finally:
                # Clean up mappings
                _session_streams.pop(sid, None)
                _session_responses.pop(sid, None)

                # Save assistant message to DB (works for complete, stopped, OR aborted)
                if full_response:
                    try:
                        assistant_msg = Message(
                            session_id=sid,
                            role="assistant",
                            content=full_response,
                            sources=sources,
                        )
                        gen_db.add(assistant_msg)
                        await gen_db.commit()
                        logger.info(f"Saved {'partial' if not sources else 'full'} response for session {sid}")
                    except Exception as e:
                        logger.error(f"Failed to save assistant message: {e}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Stop ──


@router.post("/stop")
async def chat_stop(body: ChatStopIn, db: AsyncSession = Depends(get_db)):
    """Stop an active chat stream and save partial response to DB."""
    stream_id = _session_streams.get(body.session_id)
    if stream_id is None:
        return {"status": "no_active_stream"}

    found = stop_stream(stream_id)

    # Save the accumulated partial response to DB
    partial = _session_responses.pop(body.session_id, None)
    if partial and partial["text"]:
        try:
            assistant_msg = Message(
                session_id=body.session_id,
                role="assistant",
                content=partial["text"],
                sources=partial.get("sources"),
            )
            db.add(assistant_msg)
            await db.commit()
            logger.info(f"Saved partial response ({len(partial['text'])} chars) for session {body.session_id}")
        except Exception as e:
            logger.error(f"Failed to save partial response: {e}")

    return {"status": "stopped" if found else "already_finished"}


# ── Starter questions ──


@router.get("/starter-questions")
async def starter_questions(db: AsyncSession = Depends(get_db)):
    """Generate starter questions based on indexed documentation."""
    indexed_trees = await load_indexed_trees(db)
    questions = generate_starter_questions(indexed_trees)
    return {"questions": questions}
