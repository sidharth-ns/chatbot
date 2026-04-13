"""
Claude API integration for OnboardBot chat (backend version).

Replaces the Streamlit-oriented chat.py with an SSE-event-based
async generator suitable for FastAPI's StreamingResponse.

Key differences from the original:
- stream_chat_sse yields typed SSE event dicts (not raw text chunks)
- RAG search happens INSIDE the generator (not before it)
- Stream cancellation via _active_streams dict
- No background chat threading — FastAPI handles concurrency natively
"""

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
   "This isn't covered in the indexed docs, but based on my general knowledge..." \
   so the user knows the answer didn't come from their project docs.
3. Be encouraging and welcoming — remember the user is new to the project.
4. Format commands and code in proper markdown code blocks with language hints.
5. If the question is about setup or tooling and was covered in the onboarding \
   checklist, mention that: "This was also covered in your onboarding checklist!"
6. Keep answers concise but thorough. Use bullet points for multi-part answers.
7. If multiple docs cover the topic, synthesize information from all of them."""

# Fast model for lightweight tasks (follow-ups, question generation)
FAST_MODEL = "claude-haiku-4-5-20251001"

# Reuse a single API client across calls (thread-safe — uses httpx internally)
_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


# ── Stream cancellation ──

_active_streams: dict[str, bool] = {}


def stop_stream(stream_id: str) -> bool:
    """
    Request cancellation of an active stream.

    Returns True if the stream was found and flagged, False otherwise.
    """
    if stream_id in _active_streams:
        _active_streams[stream_id] = False  # False = "please stop"
        return True
    return False


async def stream_chat_sse(
    messages: list[dict],
    indexed_trees: Optional[dict] = None,
    model: str = None,
) -> AsyncGenerator[dict, None]:
    """
    Perform RAG retrieval then stream a chat response as SSE event dicts.

    Yields events in order:
        {"type": "stream_start", "data": {"stream_id": "<uuid>"}}
        {"type": "search_start"}                          # RAG search begins
        {"type": "sources", "data": [...]}                # retrieved sources
        {"type": "token", "data": "text chunk"}           # streamed tokens
        {"type": "done", "data": {"full_response": "...", "sources": [...], "followups": [...]}}
        --- OR on cancellation ---
        {"type": "stopped", "data": {"partial_response": "..."}}
        --- OR on error ---
        {"type": "error", "data": {"message": "..."}}
    """
    model = model or CHAT_MODEL
    client = _get_client()

    stream_id = str(uuid.uuid4())
    _active_streams[stream_id] = True  # True = "keep going"

    yield {"type": "stream_start", "data": {"stream_id": stream_id}}

    try:
        # ── RAG search ──
        user_query = messages[-1].get("content", "") if messages else ""
        sources: list[dict] = []
        context = ""

        if indexed_trees and user_query:
            yield {"type": "search_start"}
            sources = search_trees(user_query, indexed_trees, model=model)
            if sources:
                context = build_context(sources)

        yield {"type": "sources", "data": sources}

        # ── Build system prompt with context ──
        if context:
            system = f"""{SYSTEM_PROMPT}

<retrieved_documentation>
{context}
</retrieved_documentation>

Use the above documentation context to answer the user's question. Cite the document \
and section when referencing specific information."""
        else:
            system = SYSTEM_PROMPT

        # Keep last 10 messages, filter out empty content
        recent_messages = messages[-10:]
        anthropic_messages = [
            {"role": m["role"], "content": m["content"]}
            for m in recent_messages
            if m.get("content", "").strip()
        ]

        if not anthropic_messages:
            yield {"type": "error", "data": {"message": "No valid messages to send"}}
            return

        # ── Stream response ──
        full_response = ""

        with client.messages.stream(
            model=model,
            max_tokens=2048,
            system=system,
            messages=anthropic_messages,
        ) as stream:
            for text in stream.text_stream:
                # Check cancellation before yielding each token
                if not _active_streams.get(stream_id, False):
                    yield {"type": "stopped", "data": {"partial_response": full_response}}
                    return

                full_response += text
                yield {"type": "token", "data": text}

        # ── Generate follow-up questions ──
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
        yield {"type": "error", "data": {"message": "Invalid API key. Please check your ANTHROPIC_API_KEY."}}
    except anthropic.RateLimitError as e:
        logger.warning(f"Rate limited during chat: {e}")
        yield {"type": "error", "data": {"message": "Rate limit reached. Please wait a moment and try again."}}
    except anthropic.APIConnectionError as e:
        logger.error(f"API connection error: {e}")
        yield {"type": "error", "data": {"message": "Connection error. Please check your network and try again."}}
    except Exception as e:
        logger.error(f"Unexpected chat error: {e}")
        yield {"type": "error", "data": {"message": f"Unexpected error: {e}"}}
    finally:
        # Clean up stream tracking
        _active_streams.pop(stream_id, None)


# ── Starter & follow-up question generation ──


def generate_starter_questions(
    indexed_trees: Optional[dict] = None,
    model: str = None,
) -> list[str]:
    """Generate 5-8 starter questions based on indexed documentation."""
    if not indexed_trees:
        return _default_starters()

    model = model or FAST_MODEL
    client = _get_client()

    doc_summaries = []
    for filename, tree_data in indexed_trees.items():
        tree = tree_data.get("tree", tree_data)
        doc_name = tree.get("doc_name", filename)
        desc = tree.get("doc_description", "")
        top_titles = [n.get("title", "") for n in tree.get("structure", [])[:6]]
        doc_summaries.append(
            f"- {doc_name} ({filename}): {desc or ', '.join(top_titles)}"
        )

    prompt = f"""Based on these project documentation files, generate 6 starter \
questions that a new team member would likely ask on their first day. \
Focus on: architecture understanding, setup clarifications, workflow questions, \
and "how does X work" questions.

Documents:
{chr(10).join(doc_summaries)}

Return ONLY a JSON array of question strings."""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
        if not response.content:
            raise ValueError("Empty response")
        text = response.content[0].text.strip()
        result = _parse_json_list(text)
        return [str(q) for q in result if isinstance(q, str) and q.strip()][:8] or _default_starters()
    except Exception as e:
        logger.warning(f"Failed to generate starter questions: {e}")
        return _default_starters()


def _generate_followups(
    user_question: str,
    assistant_response: str,
) -> list[str]:
    """Generate 2-3 contextual follow-up questions after a response."""
    client = _get_client()

    prompt = """Based on the question and answer, suggest 2-3 natural follow-up \
questions the user might ask next. Keep them concise (under 10 words each).
Return ONLY a JSON array of strings."""

    try:
        response = client.messages.create(
            model=FAST_MODEL,
            max_tokens=256,
            messages=[
                {"role": "user", "content": user_question},
                {"role": "assistant", "content": assistant_response[:500]},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
        )
        if not response.content:
            return []
        text = response.content[0].text.strip()
        result = _parse_json_list(text)
        return [str(q) for q in result if isinstance(q, str) and q.strip()][:3]
    except Exception as e:
        logger.warning(f"Failed to generate follow-up questions: {e}")
        return []


def _parse_json_list(text: str) -> list:
    """Safely parse a JSON list from LLM output."""
    if "```" in text:
        text = text.split("```")[1].split("```")[0]
        if text.startswith("json"):
            text = text[4:]
    parsed = json.loads(text.strip())
    if not isinstance(parsed, list):
        return []
    return parsed


def _default_starters() -> list[str]:
    return [
        "What is this project about?",
        "How do I set up my development environment?",
        "What's the project architecture?",
        "How do I run the tests?",
        "What's the contribution workflow?",
    ]
