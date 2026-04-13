"""
Onboarding checklist logic (backend version).

Manages a conversational checklist flow that guides new team members
through environment setup before enabling free-form chat.

All functions are pure — they accept a ChecklistState Pydantic model
instead of Streamlit session_state. State persistence is handled
by the router / database layer.
"""

import json
import functools
import os
from typing import Optional

from pydantic import BaseModel

from core.retrieval import search_nodes_by_keywords

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config",
    "checklist_config.json",
)


class ChecklistState(BaseModel):
    """Pydantic model representing checklist progress for a session."""
    answers: dict[str, str] = {}
    skipped: bool = False


@functools.lru_cache(maxsize=1)
def load_config() -> dict:
    """Load checklist configuration from JSON file (cached after first read)."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
    # Validate required keys
    if "questions" not in config or not isinstance(config["questions"], list):
        raise ValueError("checklist_config.json must have a 'questions' list")
    return config


def mark_answered(state: ChecklistState, question_id: str, answer: str) -> ChecklistState:
    """
    Record a yes/no answer for a checklist question.

    Pure function — returns a new ChecklistState with the answer applied.
    Validates both the answer value and the question_id.
    """
    if answer not in ("yes", "no"):
        raise ValueError(f"Invalid answer: {answer}. Must be 'yes' or 'no'.")
    config = load_config()
    valid_ids = {q["id"] for q in config["questions"]}
    if question_id not in valid_ids:
        raise ValueError(f"Invalid question_id: {question_id}")

    new_answers = {**state.answers, question_id: answer}
    return ChecklistState(answers=new_answers, skipped=state.skipped)


def get_current_question(state: ChecklistState) -> Optional[dict]:
    """Get the next unanswered checklist question, or None if all done."""
    config = load_config()

    for question in config["questions"]:
        if question["id"] not in state.answers:
            return question
    return None


def get_progress(state: ChecklistState) -> tuple[int, int]:
    """Returns (completed_count, total_count)."""
    config = load_config()
    total = len(config["questions"])
    completed = len(state.answers)
    return completed, total


def is_complete(state: ChecklistState) -> bool:
    """Check if all checklist questions have been answered or skipped."""
    if state.skipped:
        return True
    config = load_config()
    return len(state.answers) >= len(config["questions"])


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
