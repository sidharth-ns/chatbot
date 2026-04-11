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
import atexit
import logging
import threading
import concurrent.futures
from datetime import datetime, timezone
from typing import Optional, Callable
from unittest.mock import MagicMock

logger = logging.getLogger(__name__)

# Mock PDF dependencies before importing PageIndex (we only use markdown processing)
# WARNING: This persists for the entire process — do not install PyPDF2/pymupdf alongside this app
sys.modules.setdefault("PyPDF2", MagicMock())
sys.modules.setdefault("pymupdf", MagicMock())

# Add PageIndex to path — auto-clone if missing (e.g., Streamlit Cloud deployment)
_base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_lib_path = os.path.join(_base_dir, "lib", "PageIndex")

if not os.path.isdir(os.path.join(_lib_path, "pageindex")):
    import subprocess
    os.makedirs(os.path.join(_base_dir, "lib"), exist_ok=True)
    try:
        subprocess.run(
            ["git", "clone", "https://github.com/VectifyAI/PageIndex.git", _lib_path],
            check=True,
            capture_output=True,
        )
    except Exception as e:
        logger.error(f"Failed to clone PageIndex: {e}. Run: git clone https://github.com/VectifyAI/PageIndex.git lib/PageIndex")
        raise RuntimeError(
            "PageIndex library not found. Run: git clone https://github.com/VectifyAI/PageIndex.git lib/PageIndex"
        ) from e

if _lib_path not in sys.path:
    sys.path.insert(0, _lib_path)

from pageindex.page_index_md import md_to_tree  # noqa: E402

from config.settings import PAGEINDEX_MODEL, CACHE_DIR  # noqa: E402

# Thread pool for running async code — cleaned up on exit
_thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
atexit.register(_thread_pool.shutdown, wait=False)

# Timeout for async LLM operations (seconds)
_ASYNC_TIMEOUT = 300

SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "__pycache__", ".tox", ".mypy_cache", "env", ".env"}


def _run_async(coro):
    """Run an async coroutine in a fresh event loop on a separate thread.

    This avoids nest_asyncio issues with httpx/anyio that occur when
    patching the main event loop. Times out after _ASYNC_TIMEOUT seconds.
    """
    future = _thread_pool.submit(asyncio.run, coro)
    return future.result(timeout=_ASYNC_TIMEOUT)


def _file_hash(filepath: str) -> str:
    """SHA256 hash of file content (first 32 hex chars for better collision resistance)."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()[:32]


def _cache_path(filename: str, content_hash: str) -> str:
    """Generate cache file path: pageindex_cache/{filename}_{hash}.json."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    # Sanitize filename to prevent path traversal
    safe_name = re.sub(r'[^\w\-.]', '_', os.path.splitext(filename)[0])
    return os.path.join(CACHE_DIR, f"{safe_name}_{content_hash}.json")


def _load_from_cache(filepath: str, content_hash: str) -> Optional[dict]:
    """Check cache and return tree dict if file content hasn't changed."""
    filename = os.path.basename(filepath)
    cache_file = _cache_path(filename, content_hash)
    if os.path.exists(cache_file):
        with open(cache_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def _save_to_cache(filepath: str, content_hash: str, tree: dict) -> None:
    """Save tree JSON to cache directory."""
    filename = os.path.basename(filepath)
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

    # Compute hash once, reuse throughout
    content_hash = _file_hash(filepath)

    # Check cache first
    if not force_reindex:
        cached = _load_from_cache(filepath, content_hash)
        if cached is not None:
            if progress_callback:
                progress_callback(f"Loaded from cache: {filename}")
            return {
                "tree": cached,
                "file_hash": content_hash,
                "indexed_at": cached.get("_indexed_at", ""),
                "cached": True,
            }

    if progress_callback:
        progress_callback(f"Indexing: {filename}...")

    # Run async md_to_tree in a separate thread with a clean event loop
    # summary_token_threshold=500: sections under 500 tokens use raw text as summary
    # (no LLM call needed), saving ~50% of API calls for typical docs
    tree = _run_async(
        md_to_tree(
            md_path=filepath,
            if_thinning=False,
            if_add_node_summary="yes",
            summary_token_threshold=500,
            model=model,
            if_add_doc_description="yes",
            if_add_node_text="yes",
            if_add_node_id="yes",
        )
    )

    # Add indexing timestamp
    tree["_indexed_at"] = datetime.now(timezone.utc).isoformat()

    # Cache to disk
    _save_to_cache(filepath, content_hash, tree)

    if progress_callback:
        progress_callback(f"Done: {filename}")

    return {
        "tree": tree,
        "file_hash": content_hash,
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


# ============================================================
# Background indexing — survives Streamlit page switches
# ============================================================

_bg_indexing = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_file": "",
    "results": {},
    "complete": False,
    "error": None,
}
_bg_lock = threading.Lock()


def get_bg_status() -> dict:
    """Get current background indexing status (thread-safe deep copy)."""
    with _bg_lock:
        return {
            **_bg_indexing,
            "results": dict(_bg_indexing["results"]),  # Copy the mutable dict
        }


def start_bg_indexing(filepaths: list[str], model: str = None, force_reindex: bool = False) -> None:
    """Start indexing files in a background thread."""
    with _bg_lock:
        if _bg_indexing["running"]:
            return  # Already running
        _bg_indexing["running"] = True
        _bg_indexing["progress"] = 0
        _bg_indexing["total"] = len(filepaths)
        _bg_indexing["current_file"] = ""
        _bg_indexing["results"] = {}
        _bg_indexing["complete"] = False
        _bg_indexing["error"] = None

    def _worker():
        try:
            # Index files in parallel (up to 3 concurrent) for ~3x speedup
            max_parallel = min(3, len(filepaths))

            def _index_one(filepath):
                return os.path.basename(filepath), index_markdown_file(
                    filepath, model=model, force_reindex=force_reindex
                )

            with concurrent.futures.ThreadPoolExecutor(max_workers=max_parallel) as pool:
                futures = {
                    pool.submit(_index_one, fp): fp for fp in filepaths
                }
                for future in concurrent.futures.as_completed(futures):
                    try:
                        filename, result = future.result()
                        with _bg_lock:
                            _bg_indexing["results"][filename] = result
                            _bg_indexing["progress"] = len(_bg_indexing["results"])
                            _bg_indexing["current_file"] = filename
                    except Exception as e:
                        fp = futures[future]
                        logger.error(f"Failed to index {fp}: {e}")

            with _bg_lock:
                _bg_indexing["progress"] = _bg_indexing["total"]
                _bg_indexing["complete"] = True
        except Exception as e:
            logger.error(f"Background indexing error: {e}")
            with _bg_lock:
                _bg_indexing["error"] = str(e)
                _bg_indexing["complete"] = True
        finally:
            with _bg_lock:
                _bg_indexing["running"] = False

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()


def scan_directory(directory: str) -> list[str]:
    """
    Recursively find all .md files in a directory.

    Skips .git, node_modules, venv, __pycache__, and similar directories.
    Returns sorted list of absolute file paths.
    """
    md_files = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith((".md", ".markdown")):
                md_files.append(os.path.join(root, f))
    return sorted(md_files)
