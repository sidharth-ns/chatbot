"""
Reasoning-based tree search for document retrieval.

Searches PageIndex tree structures by presenting node titles + summaries
to Claude, which reasons about which sections likely contain the answer.
No vector database — purely LLM-driven reasoning over hierarchical structure.
"""

import json
import logging
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic

from config.settings import ANTHROPIC_API_KEY, CHAT_MODEL

logger = logging.getLogger(__name__)

# Use Haiku for search — 5-10x faster than Sonnet, and search only picks node IDs
SEARCH_MODEL = "claude-haiku-4-5-20251001"

# Reuse a single API client (thread-safe — uses httpx internally)
_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


def _extract_tree_outline(nodes: list, depth: int = 0, max_depth: int = 20) -> list[dict]:
    """Extract titles + summaries + node_ids from tree, omitting full text."""
    if depth >= max_depth:
        return []
    outline = []
    for node in nodes:
        entry = {
            "node_id": node.get("node_id", ""),
            "title": node.get("title", ""),
        }
        summary = node.get("summary") or node.get("prefix_summary", "")
        if summary:
            entry["summary"] = summary[:300] + "..." if len(summary) > 300 else summary
        if node.get("nodes"):
            entry["children"] = _extract_tree_outline(node["nodes"], depth + 1, max_depth)
        outline.append(entry)
    return outline


def format_tree_for_llm(tree: dict) -> str:
    """Format tree structure for LLM consumption (titles + summaries only)."""
    structure = tree.get("structure", [])
    outline = _extract_tree_outline(structure)
    return json.dumps(outline, indent=2, ensure_ascii=False)


def find_node_by_id(structure: list, node_id: str, max_depth: int = 50) -> Optional[dict]:
    """Find a node by its node_id using iterative search (no recursion limit)."""
    stack = list(structure)
    depth = 0
    while stack and depth < max_depth:
        node = stack.pop()
        if node.get("node_id") == node_id:
            return node
        if node.get("nodes"):
            stack.extend(node["nodes"])
        depth += 1
    return None


def get_heading_path(structure: list, target_id: str, path: list = None) -> str:
    """Build breadcrumb path like 'Backend > Database > Migrations' for a node."""
    if path is None:
        path = []
    for node in structure:
        current_path = path + [node.get("title", "")]
        if node.get("node_id") == target_id:
            return " > ".join(current_path)
        if node.get("nodes"):
            result = get_heading_path(node["nodes"], target_id, current_path)
            if result:
                return result
    return ""


def _parse_json_list(text: str) -> list:
    """Safely parse a JSON list from LLM output, handling code blocks."""
    text = text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]
    parsed = json.loads(text.strip())
    if not isinstance(parsed, list):
        return []
    return parsed


def search_single_tree(
    question: str,
    tree: dict,
    filename: str,
    client: anthropic.Anthropic,
    model: str = None,
    max_nodes: int = 3,
) -> list[dict]:
    """
    Use Claude to reason over one document's tree and find relevant nodes.
    Returns list of retrieved node dicts.
    """
    model = model or SEARCH_MODEL
    tree_summary = format_tree_for_llm(tree)
    doc_name = tree.get("doc_name", filename)

    # User input is wrapped in XML tags to mitigate prompt injection
    prompt = f"""You are a document retrieval assistant. Given a user question and
a document's table of contents with section summaries, identify which sections
are most likely to contain relevant information.

<user_question>{question}</user_question>

Document: {doc_name} ({filename})
Structure:
{tree_summary}

Return a JSON list of the most relevant node IDs (max {max_nodes}).
Only return node IDs, nothing else.
Example: ["0001", "0003", "0007"]"""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        if not response.content:
            return []
        result_text = response.content[0].text.strip()

        node_ids = _parse_json_list(result_text)
        # Validate: ensure all elements are strings
        node_ids = [str(nid) for nid in node_ids[:max_nodes]]
    except anthropic.AuthenticationError:
        raise  # Don't silently swallow auth errors
    except anthropic.RateLimitError as e:
        logger.warning(f"Rate limited during search of {filename}: {e}")
        return []
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse search results for {filename}: {e}")
        return []
    except Exception as e:
        logger.error(f"Unexpected error searching {filename}: {e}")
        return []

    # Look up full node data for each ID
    structure = tree.get("structure", [])
    results = []
    for nid in node_ids:
        node = find_node_by_id(structure, nid)
        if node:
            results.append({
                "file_name": filename,
                "node_id": nid,
                "node_title": node.get("title", ""),
                "heading_path": get_heading_path(structure, nid),
                "content": node.get("text", node.get("summary", "")),
                "summary": node.get("summary") or node.get("prefix_summary", ""),
            })
    return results


def _doc_matches_question(question: str, tree: dict) -> bool:
    """Quick keyword check: does this doc likely contain relevant content?"""
    q_words = set(question.lower().split())
    q_words -= {"what", "how", "is", "the", "a", "an", "do", "does", "i", "to",
                "can", "my", "me", "in", "of", "for", "and", "or", "this", "that",
                "it", "be", "are", "was", "with", "have", "about", "where", "which"}
    if not q_words:
        return True

    searchable = tree.get("doc_name", "").lower()
    searchable += " " + tree.get("doc_description", "").lower()
    for node in tree.get("structure", []):
        searchable += " " + node.get("title", "").lower()
        searchable += " " + (node.get("summary") or node.get("prefix_summary", "")).lower()[:200]
        for child in node.get("nodes", []):
            searchable += " " + child.get("title", "").lower()

    return bool(q_words & set(searchable.split()))


def search_trees(
    question: str,
    indexed_trees: dict,
    model: str = None,
    max_nodes_per_doc: int = 3,
) -> list[dict]:
    """
    Search across indexed document trees IN PARALLEL.

    Optimizations:
    1. Pre-filters docs by keyword to skip irrelevant ones
    2. Uses Haiku (fast model) for search
    3. Searches remaining docs concurrently
    """
    search_model = SEARCH_MODEL
    client = _get_client()
    all_results = []

    # Pre-filter: skip docs that clearly don't match the question
    relevant_trees = {}
    for filename, tree_data in indexed_trees.items():
        tree = tree_data.get("tree", tree_data)
        if _doc_matches_question(question, tree):
            relevant_trees[filename] = tree_data

    if not relevant_trees:
        relevant_trees = indexed_trees

    if not relevant_trees:
        return []

    # Search relevant documents concurrently
    with ThreadPoolExecutor(max_workers=max(1, min(len(relevant_trees), 5))) as executor:
        futures = {}
        for filename, tree_data in relevant_trees.items():
            tree = tree_data.get("tree", tree_data)
            future = executor.submit(
                search_single_tree, question, tree, filename, client, search_model, max_nodes_per_doc
            )
            futures[future] = filename

        for future in as_completed(futures):
            try:
                results = future.result()
                all_results.extend(results)
            except anthropic.AuthenticationError:
                raise  # Propagate auth errors
            except Exception as e:
                logger.warning(f"Search failed for {futures[future]}: {e}")
                continue

    # If too many results, rank them
    if len(all_results) > 5:
        all_results = rank_candidates(question, all_results, client, search_model)

    return all_results[:5]


def rank_candidates(
    question: str,
    candidates: list[dict],
    client: anthropic.Anthropic,
    model: str = None,
) -> list[dict]:
    """Ask Claude to rank candidates by relevance if we have too many."""
    model = model or SEARCH_MODEL

    candidate_summary = []
    for i, c in enumerate(candidates):
        candidate_summary.append(
            f"{i}: [{c['file_name']}] {c['heading_path']} — {c.get('summary', '')[:150]}"
        )

    prompt = f"""Given this question and a list of document sections, rank the top 5
most relevant sections by their index number.

<user_question>{question}</user_question>

Sections:
{chr(10).join(candidate_summary)}

Return ONLY a JSON list of index numbers, most relevant first.
Example: [2, 0, 5, 1, 3]"""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=128,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        if not response.content:
            return candidates[:5]
        result_text = response.content[0].text.strip()
        indices = _parse_json_list(result_text)
        # Validate: must be integers within bounds
        return [candidates[i] for i in indices
                if isinstance(i, int) and 0 <= i < len(candidates)][:5]
    except Exception as e:
        logger.warning(f"Ranking failed, returning unranked: {e}")
        return candidates[:5]


def build_context(results: list[dict], max_chars: int = 32000) -> str:
    """Format retrieved nodes as context string for the chat prompt."""
    if not results:
        return ""

    parts = []
    total = 0
    for r in results:
        header = f"### From {r['file_name']} > {r['heading_path']}\n\n"
        content = r.get("content", "")
        section = header + content + "\n\n---\n\n"

        if total + len(section) > max_chars:
            remaining = max_chars - total
            if remaining > 200:
                parts.append(section[:remaining] + "\n...[truncated]")
            break

        parts.append(section)
        total += len(section)

    return "".join(parts)


def search_nodes_by_keywords(
    search_terms: list[str],
    indexed_trees: dict,
) -> list[dict]:
    """
    Simple keyword-based search across tree node titles and summaries.
    Used by the checklist for quick lookups without LLM calls.
    """
    results = []
    terms_lower = [t.lower() for t in search_terms]

    for filename, tree_data in indexed_trees.items():
        tree = tree_data.get("tree", tree_data)
        structure = tree.get("structure", [])
        _search_nodes_iterative(structure, filename, terms_lower, results)

    results.sort(key=lambda x: x["match_count"], reverse=True)
    return results[:5]


def _search_nodes_iterative(
    nodes: list, filename: str, terms: list[str], results: list
):
    """Iteratively search nodes for keyword matches (no recursion limit)."""
    stack = list(nodes)
    while stack:
        node = stack.pop()
        title = node.get("title", "").lower()
        summary = (node.get("summary") or node.get("prefix_summary", "")).lower()
        text = node.get("text", "").lower()
        searchable = f"{title} {summary} {text}"

        match_count = sum(1 for term in terms if term in searchable)
        if match_count > 0:
            results.append({
                "file_name": filename,
                "node_id": node.get("node_id", ""),
                "node_title": node.get("title", ""),
                "content": node.get("text", node.get("summary", "")),
                "match_count": match_count,
            })

        if node.get("nodes"):
            stack.extend(node["nodes"])
