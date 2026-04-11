"""
Claude API integration for OnboardBot chat.

Handles system prompt assembly, RAG context formatting,
streaming responses, and suggested question generation.
"""

import json
from typing import Generator, Optional

import anthropic

from config.settings import ANTHROPIC_API_KEY, CHAT_MODEL
from core.retrieval import search_trees, build_context

SYSTEM_PROMPT = """You are OnboardBot, a friendly and patient onboarding assistant \
that helps new team members understand a project by answering questions based on \
the project's documentation.

Rules:
1. Answer ONLY based on the provided documentation context below. Do not make up \
   information or assume things not in the docs.
2. Always cite your sources — mention which file and section the information comes \
   from. Format as: "According to **ARCHITECTURE.md** > *Deployment* section..."
3. If the provided context does not contain enough information to answer the \
   question, say: "I couldn't find information about this in the indexed docs. \
   You might want to ask the team directly or check if there's additional \
   documentation that hasn't been indexed."
4. Be encouraging and welcoming — remember the user is new to the project.
5. Format commands and code in proper markdown code blocks with language hints.
6. If the question is about setup or tooling and was covered in the onboarding \
   checklist, mention that: "This was also covered in your onboarding checklist!"
7. Keep answers concise but thorough. Use bullet points for multi-part answers.
8. If multiple docs cover the topic, synthesize information from all of them."""


def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


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
    user_query = messages[-1]["content"] if messages else ""
    sources = []
    context = ""

    if indexed_trees and user_query:
        sources = search_trees(user_query, indexed_trees, model=model)
        if sources:
            context = build_context(sources)

    # Build system prompt with context
    if context:
        system = f"""{SYSTEM_PROMPT}

---
RETRIEVED DOCUMENTATION CONTEXT:
{context}
---

Use the above context to answer the user's question. Cite the document and section \
when referencing specific information."""
    else:
        system = SYSTEM_PROMPT

    # Keep last 10 messages for conversation context
    recent_messages = messages[-10:]
    anthropic_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in recent_messages
    ]

    def _stream():
        with client.messages.stream(
            model=model,
            max_tokens=2048,
            system=system,
            messages=anthropic_messages,
        ) as stream:
            for text in stream.text_stream:
                yield text

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

    model = model or CHAT_MODEL
    client = _get_client()

    # Build a summary of available docs
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

Return ONLY a JSON array of question strings, like:
["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?", "Question 6?"]"""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
        text = response.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1].split("```")[0]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception:
        return [
            "What is this project about?",
            "How do I set up my development environment?",
            "What's the project architecture?",
            "How do I run the tests?",
            "What's the contribution workflow?",
        ]


def generate_followup_questions(
    user_question: str,
    assistant_response: str,
    model: str = None,
) -> list[str]:
    """Generate 2-3 contextual follow-up questions after a response."""
    model = model or CHAT_MODEL
    client = _get_client()

    prompt = f"""Based on the question "{user_question}" and the answer provided, \
suggest 2-3 natural follow-up questions the user might want to ask next. \
Keep them concise (under 10 words each).
Return ONLY a JSON array of strings."""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=256,
            messages=[
                {"role": "user", "content": user_question},
                {"role": "assistant", "content": assistant_response[:500]},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
        )
        text = response.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1].split("```")[0]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())[:3]
    except Exception:
        return []
