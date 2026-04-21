"""
Claude API integration — SSE event generator for streaming chat responses.

Uses the Anthropic async client for true token-by-token streaming.
"""

import json
import logging
import uuid
import asyncio
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

# Async client for true streaming
_async_client: Optional[anthropic.AsyncAnthropic] = None
# Sync client for non-streaming calls (starter questions, follow-ups)
_sync_client: Optional[anthropic.Anthropic] = None

# Stream cancellation flags: stream_id -> cancelled (True = stop)
_active_streams: dict[str, bool] = {}


def _get_async_client() -> anthropic.AsyncAnthropic:
    global _async_client
    if _async_client is None:
        _async_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _async_client


def _get_sync_client() -> anthropic.Anthropic:
    global _sync_client
    if _sync_client is None:
        _sync_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _sync_client


def stop_stream(stream_id: str) -> bool:
    """Request cancellation of an active stream."""
    if stream_id in _active_streams:
        _active_streams[stream_id] = True  # True = cancelled
        return True
    return False


async def stream_chat_sse(
    messages: list[dict],
    indexed_trees: Optional[dict] = None,
    model: str = None,
) -> AsyncGenerator[dict, None]:
    """
    Perform RAG retrieval then stream a chat response as SSE event dicts.
    Uses the async Anthropic client for true token-by-token streaming.
    """
    model = model or CHAT_MODEL
    client = _get_async_client()

    stream_id = str(uuid.uuid4())
    _active_streams[stream_id] = False  # False = not cancelled

    yield {"type": "stream_start", "data": {"stream_id": stream_id}}

    try:
        # RAG search (runs in thread pool since retrieval.py is sync)
        user_query = messages[-1].get("content", "") if messages else ""
        sources: list[dict] = []
        context = ""

        if indexed_trees and user_query:
            yield {"type": "search_start"}
            loop = asyncio.get_event_loop()
            sources = await loop.run_in_executor(
                None, search_trees, user_query, indexed_trees
            )
            if sources:
                context = build_context(sources)

        yield {"type": "sources", "data": sources}

        # Build system prompt
        if context:
            system = f"""{SYSTEM_PROMPT}

<retrieved_documentation>
{context}
</retrieved_documentation>

Use the above documentation context to answer the user's question. Cite the document \
and section when referencing specific information."""
        else:
            system = SYSTEM_PROMPT

        # Filter messages
        recent_messages = messages[-10:]
        anthropic_messages = [
            {"role": m["role"], "content": m["content"]}
            for m in recent_messages
            if m.get("content", "").strip()
        ]

        if not anthropic_messages:
            yield {"type": "error", "data": {"message": "No valid messages to send"}}
            return

        # Stream response using ASYNC client — true token-by-token streaming
        full_response = ""

        async with client.messages.stream(
            model=model,
            max_tokens=2048,
            system=system,
            messages=anthropic_messages,
        ) as stream:
            async for text in stream.text_stream:
                # Check cancellation
                if _active_streams.get(stream_id, False):
                    yield {"type": "stopped", "data": {"partial_response": full_response}}
                    return

                full_response += text
                yield {"type": "token", "data": text}

        # Generate follow-up questions (sync, run in executor)
        loop = asyncio.get_event_loop()
        followups = await loop.run_in_executor(
            None, _generate_followups, user_query, full_response
        )

        yield {
            "type": "done",
            "data": {
                "full_response": full_response,
                "sources": sources,
                "followups": followups,
            },
        }

    except anthropic.AuthenticationError:
        yield {"type": "error", "data": {"message": "Invalid API key. Check ANTHROPIC_API_KEY."}}
    except anthropic.RateLimitError:
        yield {"type": "error", "data": {"message": "Rate limit reached. Please wait a moment."}}
    except Exception as e:
        logger.error(f"Stream error: {e}")
        yield {"type": "error", "data": {"message": str(e)[:200]}}
    finally:
        _active_streams.pop(stream_id, None)


def _generate_followups(question: str, response: str) -> list[str]:
    """Generate follow-up question suggestions using Haiku (sync)."""
    try:
        client = _get_sync_client()
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
        if not isinstance(result, list):
            return []
        return [str(q) for q in result if isinstance(q, str) and q.strip()][:3]
    except Exception:
        return []


def generate_starter_questions(indexed_trees: Optional[dict] = None) -> list[str]:
    """Generate starter question suggestions based on indexed docs."""
    defaults = [
        "What is this project about?",
        "How do I set up my development environment?",
        "What's the project architecture?",
        "How do I run the tests?",
        "What's the contribution workflow?",
    ]
    if not indexed_trees:
        return defaults

    client = _get_sync_client()
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
        if not isinstance(result, list):
            return defaults
        return [str(q) for q in result if isinstance(q, str)][:8] or defaults
    except Exception:
        return defaults
