"""
Claude API integration for OnboardBot chat.

Handles system prompt assembly, RAG context formatting,
streaming responses, and suggested question generation.
"""

import json
import logging
import threading
from typing import Generator, Optional

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

# Fast model for lightweight tasks (question generation)
FAST_MODEL = "claude-haiku-4-5-20251001"

# Reuse a single API client across calls (thread-safe — uses httpx internally)
_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


def stream_chat_response(
    messages: list[dict],
    indexed_trees: Optional[dict] = None,
    model: str = None,
) -> tuple[Generator[str, None, None], list[dict]]:
    """
    Perform RAG retrieval then stream a chat response from Claude.

    Returns (generator, sources) where:
    - generator yields text chunks for st.write_stream
    - sources is a list of retrieved node dicts for the expander
    """
    model = model or CHAT_MODEL
    client = _get_client()

    # RAG: search trees for context
    user_query = messages[-1].get("content", "") if messages else ""
    sources = []
    context = ""

    if indexed_trees and user_query:
        sources = search_trees(user_query, indexed_trees, model=model)
        if sources:
            context = build_context(sources)

    # Build system prompt with context — user content wrapped in XML tags
    if context:
        system = f"""{SYSTEM_PROMPT}

<retrieved_documentation>
{context}
</retrieved_documentation>

Use the above documentation context to answer the user's question. Cite the document \
and section when referencing specific information."""
    else:
        system = SYSTEM_PROMPT

    # Keep last 10 messages for conversation context, filter out empty content
    recent_messages = messages[-10:]
    anthropic_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in recent_messages
        if m.get("content", "").strip()
    ]

    def _stream():
        try:
            with client.messages.stream(
                model=model,
                max_tokens=2048,
                system=system,
                messages=anthropic_messages,
            ) as stream:
                for text in stream.text_stream:
                    yield text
        except anthropic.AuthenticationError:
            raise  # Propagate auth errors — can't recover
        except anthropic.RateLimitError as e:
            logger.warning(f"Rate limited during chat: {e}")
            yield "\n\n⚠️ *Rate limit reached. Please wait a moment and try again.*"
        except anthropic.APIConnectionError as e:
            logger.error(f"API connection error: {e}")
            yield "\n\n⚠️ *Connection error. Please check your network and try again.*"

    return _stream(), sources


def generate_starter_questions(
    indexed_trees: Optional[dict] = None,
    model: str = None,
) -> list[str]:
    """Generate 5-8 starter questions based on indexed documentation."""
    if not indexed_trees:
        return [
            "What is this project about?",
            "How do I set up my development environment?",
            "What's the project architecture?",
            "How do I run the tests?",
            "What's the contribution workflow?",
        ]

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


def generate_followup_questions(
    user_question: str,
    assistant_response: str,
) -> list[str]:
    """Generate 2-3 contextual follow-up questions after a response."""
    client = _get_client()

    prompt = f"""Based on the question and answer, suggest 2-3 natural follow-up \
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


# ============================================================
# Background chat response — survives Streamlit page switches
# ============================================================

_bg_chat = {
    "running": False,
    "cancelled": False,  # Set to True when foreground streaming succeeds
    "gen_id": 0,         # Incremented each generation to detect stale results
    "prompt": "",
    "response": None,
    "sources": [],
    "followups": [],
    "error": None,
}
_bg_chat_lock = threading.Lock()


def get_bg_chat_status() -> dict:
    """Get background chat response status (thread-safe)."""
    with _bg_chat_lock:
        return dict(_bg_chat)


def start_bg_chat(messages: list[dict], indexed_trees: dict, prompt: str) -> None:
    """Start generating a chat response in the background."""
    with _bg_chat_lock:
        if _bg_chat["running"]:
            return
        _bg_chat["running"] = True
        _bg_chat["cancelled"] = False
        _bg_chat["gen_id"] += 1
        _bg_chat["prompt"] = prompt
        _bg_chat["response"] = None
        _bg_chat["sources"] = []
        _bg_chat["followups"] = []
        _bg_chat["error"] = None
        current_gen_id = _bg_chat["gen_id"]

    def _worker():
        try:
            model = CHAT_MODEL
            client = _get_client()

            # RAG search
            user_query = messages[-1].get("content", "") if messages else ""
            sources = []
            context = ""
            if indexed_trees and user_query:
                sources = search_trees(user_query, indexed_trees)
                if sources:
                    context = build_context(sources)

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

            recent = messages[-10:]
            # Filter out any messages with empty content (prevents API 400 errors)
            anthropic_messages = [
                {"role": m["role"], "content": m["content"]}
                for m in recent
                if m.get("content", "").strip()
            ]

            if not anthropic_messages:
                with _bg_chat_lock:
                    _bg_chat["error"] = "No valid messages to send"
                return

            # Non-streaming call (background — no UI to stream to)
            response = client.messages.create(
                model=model,
                max_tokens=2048,
                system=system,
                messages=anthropic_messages,
            )
            response_text = response.content[0].text if response.content else ""

            # Generate follow-ups
            followups = []
            try:
                followups = generate_followup_questions(prompt, response_text)
            except Exception:
                pass

            with _bg_chat_lock:
                # Only write results if not cancelled (foreground streaming didn't succeed)
                if not _bg_chat["cancelled"] and _bg_chat["gen_id"] == current_gen_id:
                    _bg_chat["response"] = response_text
                    _bg_chat["sources"] = sources
                    _bg_chat["followups"] = followups

        except Exception as e:
            logger.error(f"Background chat error: {e}")
            with _bg_chat_lock:
                if not _bg_chat["cancelled"] and _bg_chat["gen_id"] == current_gen_id:
                    _bg_chat["error"] = str(e)
        finally:
            with _bg_chat_lock:
                _bg_chat["running"] = False

    threading.Thread(target=_worker, daemon=True).start()


def clear_bg_chat() -> None:
    """Clear background chat state and cancel any pending result."""
    with _bg_chat_lock:
        _bg_chat["cancelled"] = True  # Tell worker to discard its result
        _bg_chat["response"] = None
        _bg_chat["sources"] = []
        _bg_chat["followups"] = []
        _bg_chat["error"] = None
        _bg_chat["prompt"] = ""
