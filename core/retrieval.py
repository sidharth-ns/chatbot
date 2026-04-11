"""
Reasoning-based tree search for document retrieval.

Searches PageIndex tree structures by presenting node titles + summaries
to Claude, which reasons about which sections likely contain the answer.
No vector database — purely LLM-driven reasoning over hierarchical structure.
"""

import json
from typing import Optional

import anthropic

from config.settings import ANTHROPIC_API_KEY, CHAT_MODEL


def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def _extract_tree_outline(nodes: list, depth: int = 0) -> list[dict]:
    """Extract titles + summaries + node_ids from tree, omitting full text."""
    outline = []
    for node in nodes:
        entry = {
            "node_id": node.get("node_id", ""),
            "title": node.get("title", ""),
        }
        summary = node.get("summary") or node.get("prefix_summary", "")
        if summary:
            # Truncate long summaries to save tokens
            entry["summary"] = summary[:300] + "..." if len(summary) > 300 else summary
        if node.get("nodes"):
            entry["children"] = _extract_tree_outline(node["nodes"], depth + 1)
        outline.append(entry)
    return outline


def format_tree_for_llm(tree: dict) -> str:
    """Format tree structure for LLM consumption (titles + summaries only)."""
    structure = tree.get("structure", [])
    outline = _extract_tree_outline(structure)
    return json.dumps(outline, indent=2, ensure_ascii=False)


def find_node_by_id(structure: list, node_id: str) -> Optional[dict]:
    """Recursively find a node by its node_id in the tree structure."""
    for node in structure:
        if node.get("node_id") == node_id:
            return node
        if node.get("nodes"):
            found = find_node_by_id(node["nodes"], node_id)
            if found:
                return found
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
    model = model or CHAT_MODEL
    tree_summary = format_tree_for_llm(tree)
    doc_name = tree.get("doc_name", filename)

    prompt = f"""You are a document retrieval assistant. Given this question and
a document's table of contents with section summaries, identify which sections
are most likely to contain relevant information.

Question: {question}

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
        result_text = response.content[0].text.strip()

        # Parse JSON from response (handle markdown code blocks)
        if "```json" in result_text:
            result_text = result_text.split("```json")[1].split("```")[0]
        elif "```" in result_text:
            result_text = result_text.split("```")[1].split("```")[0]

        node_ids = json.loads(result_text.strip())
    except Exception:
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


def search_trees(
    question: str,
    indexed_trees: dict,
    model: str = None,
    max_nodes_per_doc: int = 3,
) -> list[dict]:
    """
    Search across all indexed document trees.

    indexed_trees: dict mapping filename -> {"tree": {...}, ...}
    Returns list of RetrievedNode dicts sorted by relevance.
    """
    model = model or CHAT_MODEL
    client = _get_client()
    all_results = []

    for filename, tree_data in indexed_trees.items():
        tree = tree_data.get("tree", tree_data)
        try:
            results = search_single_tree(
                question, tree, filename, client, model, max_nodes_per_doc
            )
            all_results.extend(results)
        except Exception:
            continue

    # If too many results, rank them
    if len(all_results) > 5:
        all_results = rank_candidates(question, all_results, client, model)

    return all_results[:5]


def rank_candidates(
    question: str,
    candidates: list[dict],
    client: anthropic.Anthropic,
    model: str = None,
) -> list[dict]:
    """Ask Claude to rank candidates by relevance if we have too many."""
    model = model or CHAT_MODEL

    candidate_summary = []
    for i, c in enumerate(candidates):
        candidate_summary.append(
            f"{i}: [{c['file_name']}] {c['heading_path']} — {c.get('summary', '')[:150]}"
        )

    prompt = f"""Given this question and a list of document sections, rank the top 5
most relevant sections by their index number.

Question: {question}

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
        result_text = response.content[0].text.strip()
        if "```" in result_text:
            result_text = result_text.split("```")[1].split("```")[0]
            if result_text.startswith("json"):
                result_text = result_text[4:]
        indices = json.loads(result_text.strip())
        return [candidates[i] for i in indices if i < len(candidates)]
    except Exception:
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
        _search_nodes_recursive(structure, filename, terms_lower, results)

    # Sort by match count (more matches = more relevant)
    results.sort(key=lambda x: x["match_count"], reverse=True)
    return results[:5]


def _search_nodes_recursive(
    nodes: list, filename: str, terms: list[str], results: list
):
    """Recursively search nodes for keyword matches."""
    for node in nodes:
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
            _search_nodes_recursive(node["nodes"], filename, terms, results)
