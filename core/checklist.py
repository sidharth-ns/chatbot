"""
Onboarding checklist logic.

Manages a conversational checklist flow that guides new team members
through environment setup before enabling free-form chat.
When on_no.command is null, searches indexed docs for help content.
"""

import json
import os
from typing import Optional

from core.retrieval import search_nodes_by_keywords

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config",
    "checklist_config.json",
)


def load_config() -> dict:
    """Load checklist configuration from JSON file."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def init_state(session_state) -> None:
    """Initialize checklist state in Streamlit session if not present."""
    if "checklist_state" not in session_state:
        session_state.checklist_state = {}
    if "checklist_step" not in session_state:
        session_state.checklist_step = 0
    if "checklist_skipped" not in session_state:
        session_state.checklist_skipped = False
    if "checklist_messages" not in session_state:
        session_state.checklist_messages = []


def get_state(session_state) -> dict:
    """Get current checklist answers: {question_id: 'yes'|'no'|None}."""
    init_state(session_state)
    return session_state.checklist_state


def mark_answered(session_state, question_id: str, answer: str) -> None:
    """Record a yes/no answer for a checklist question."""
    init_state(session_state)
    session_state.checklist_state[question_id] = answer


def get_current_question(session_state) -> Optional[dict]:
    """Get the next unanswered checklist question, or None if all done."""
    init_state(session_state)
    config = load_config()
    state = session_state.checklist_state

    for question in config["questions"]:
        if question["id"] not in state:
            return question
    return None


def get_progress(session_state) -> tuple[int, int]:
    """Returns (completed_count, total_count)."""
    init_state(session_state)
    config = load_config()
    total = len(config["questions"])
    completed = len(session_state.checklist_state)
    return completed, total


def is_complete(session_state) -> bool:
    """Check if all checklist questions have been answered or skipped."""
    init_state(session_state)
    if session_state.checklist_skipped:
        return True
    config = load_config()
    return len(session_state.checklist_state) >= len(config["questions"])


def skip_checklist(session_state) -> None:
    """Mark checklist as skipped."""
    init_state(session_state)
    session_state.checklist_skipped = True


def reset_checklist(session_state) -> None:
    """Reset all checklist state."""
    session_state.checklist_state = {}
    session_state.checklist_step = 0
    session_state.checklist_skipped = False
    session_state.checklist_messages = []


def get_help_content(
    question: dict,
    indexed_trees: Optional[dict] = None,
) -> dict:
    """
    Build help content for a 'No' answer.

    Returns dict with 'message', 'command' (optional), 'link' (optional),
    and 'doc_content' (optional, from indexed docs).
    """
    on_no = question.get("on_no", {})
    result = {
        "message": on_no.get("message", "Here's some help:"),
        "command": on_no.get("command"),
        "link": on_no.get("link"),
        "doc_content": None,
    }

    # If no static command/link, search indexed docs
    if not result["command"] and not result["link"] and indexed_trees:
        search_terms = question.get("search_terms", [])
        if search_terms:
            matches = search_nodes_by_keywords(search_terms, indexed_trees)
            if matches:
                # Build content from top matches
                content_parts = []
                for match in matches[:3]:
                    title = match.get("node_title", "")
                    text = match.get("content", "")
                    if text:
                        content_parts.append(f"**{match['file_name']}** > {title}\n\n{text}")
                if content_parts:
                    result["doc_content"] = "\n\n---\n\n".join(content_parts)

    return result
