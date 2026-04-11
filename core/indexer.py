"""
PageIndex integration for markdown document indexing.

Wraps PageIndex's md_to_tree to provide:
- Multi-file processing with progress callbacks
- SHA256-based file caching to avoid redundant LLM calls
- Heading structure validation
- Directory scanning with common exclusions
"""

import os
import sys
import json
import hashlib
import asyncio
import re
import concurrent.futures
from datetime import datetime, timezone
from typing import Optional, Callable
from unittest.mock import MagicMock

# Mock PDF dependencies before importing PageIndex (we only use markdown processing)
sys.modules.setdefault("PyPDF2", MagicMock())
sys.modules.setdefault("pymupdf", MagicMock())

# Add PageIndex to path
_lib_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib", "PageIndex")
if _lib_path not in sys.path:
    sys.path.insert(0, _lib_path)

from pageindex.page_index_md import md_to_tree  # noqa: E402

from config.settings import PAGEINDEX_MODEL, CACHE_DIR  # noqa: E402

# Directories to skip when scanning folders
_thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)


def _run_async(coro):
    """Run an async coroutine in a fresh event loop on a separate thread.

    This avoids nest_asyncio issues with httpx/anyio that occur when
    patching the main event loop.
    """
    future = _thread_pool.submit(asyncio.run, coro)
    return future.result()
SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "__pycache__", ".tox", ".mypy_cache", "env", ".env"}


def _file_hash(filepath: str) -> str:
    """SHA256 hash of file content (first 16 hex chars)."""
    with open(filepath, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


def _cache_path(filename: str, content_hash: str) -> str:
    """Generate cache file path: pageindex_cache/{filename}_{hash}.json."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    safe_name = os.path.splitext(filename)[0]
    return os.path.join(CACHE_DIR, f"{safe_name}_{content_hash}.json")


def _load_from_cache(filepath: str) -> Optional[dict]:
    """Check cache and return tree dict if file content hasn't changed."""
    filename = os.path.basename(filepath)
    content_hash = _file_hash(filepath)
    cache_file = _cache_path(filename, content_hash)
    if os.path.exists(cache_file):
        with open(cache_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def _save_to_cache(filepath: str, tree: dict) -> None:
    """Save tree JSON to cache directory."""
    filename = os.path.basename(filepath)
    content_hash = _file_hash(filepath)
    cache_file = _cache_path(filename, content_hash)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(tree, f, indent=2, ensure_ascii=False)


def has_heading_structure(filepath: str) -> bool:
    """Check if a markdown file has any # headings."""
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            if re.match(r"^#{1,6}\s+", line):
                return True
    return False


def count_nodes(tree: dict) -> int:
    """Count total nodes in a tree structure."""
    def _count(nodes):
        total = 0
        for node in nodes:
            total += 1
            if node.get("nodes"):
                total += _count(node["nodes"])
        return total

    return _count(tree.get("structure", []))


def index_markdown_file(
    filepath: str,
    model: str = None,
    force_reindex: bool = False,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Index a single markdown file using PageIndex md_to_tree.

    Returns a dict with tree structure, file metadata, and cache status.
    Uses disk cache if file content hasn't changed.
    """
    model = model or PAGEINDEX_MODEL
    filename = os.path.basename(filepath)

    # Check cache first
    if not force_reindex:
        cached = _load_from_cache(filepath)
        if cached is not None:
            if progress_callback:
                progress_callback(f"Loaded from cache: {filename}")
            return {
                "tree": cached,
                "file_hash": _file_hash(filepath),
                "indexed_at": cached.get("_indexed_at", ""),
                "cached": True,
            }

    if progress_callback:
        progress_callback(f"Indexing: {filename}...")

    # Run async md_to_tree in a separate thread with a clean event loop
    tree = _run_async(
        md_to_tree(
            md_path=filepath,
            if_thinning=False,
            if_add_node_summary="yes",
            summary_token_threshold=200,
            model=model,
            if_add_doc_description="yes",
            if_add_node_text="yes",
            if_add_node_id="yes",
        )
    )

    # Add indexing timestamp
    tree["_indexed_at"] = datetime.now(timezone.utc).isoformat()

    # Cache to disk
    _save_to_cache(filepath, tree)

    if progress_callback:
        progress_callback(f"Done: {filename}")

    return {
        "tree": tree,
        "file_hash": _file_hash(filepath),
        "indexed_at": tree["_indexed_at"],
        "cached": False,
    }


def index_multiple_files(
    filepaths: list[str],
    model: str = None,
    force_reindex: bool = False,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Index multiple markdown files.

    Returns dict mapping filename -> {tree, file_hash, indexed_at, cached}.
    """
    results = {}
    for filepath in filepaths:
        filename = os.path.basename(filepath)
        result = index_markdown_file(
            filepath,
            model=model,
            force_reindex=force_reindex,
            progress_callback=progress_callback,
        )
        results[filename] = result
    return results


def scan_directory(directory: str) -> list[str]:
    """
    Recursively find all .md files in a directory.

    Skips .git, node_modules, venv, __pycache__, and similar directories.
    Returns sorted list of absolute file paths.
    """
    md_files = []
    for root, dirs, files in os.walk(directory):
        # Filter out skipped directories in-place
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith((".md", ".markdown")):
                md_files.append(os.path.join(root, f))
    return sorted(md_files)
