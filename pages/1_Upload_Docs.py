import streamlit as st
import os
import html
import time
import tempfile
import shutil

st.set_page_config(page_title="Upload Docs - OnboardBot", page_icon="🤖", layout="wide")

from config.settings import ANTHROPIC_API_KEY, SAMPLE_DOCS_DIR
from core.indexer import (
    index_markdown_file, scan_directory, count_nodes,
    has_heading_structure, start_bg_indexing, get_bg_status,
    _bg_lock, _bg_indexing,
)

# --- Sidebar: Indexed docs status ---
with st.sidebar:
    st.header("🤖 OnboardBot")
    st.divider()

    trees = st.session_state.get("indexed_trees", {})
    if trees:
        total_files = len(trees)
        total_nodes = sum(count_nodes(t.get("tree", t)) for t in trees.values())
        st.success(f"📄 {total_files} files indexed ({total_nodes} sections)")

        for filename, tree_data in trees.items():
            tree = tree_data.get("tree", tree_data)
            cached = tree_data.get("cached", False)
            badge = " (cached)" if cached else ""
            with st.expander(f"📄 {tree.get('doc_name', filename)}{badge}"):
                def _render_toc(nodes, indent=0):
                    for node in nodes:
                        prefix = "  " * indent
                        nid = node.get("node_id", "")
                        title = html.escape(node.get("title", ""))
                        st.markdown(f"{prefix}`{nid}` {title}")
                        if node.get("nodes"):
                            _render_toc(node["nodes"], indent + 1)
                _render_toc(tree.get("structure", []))

        st.divider()
        if st.button("🔄 Re-index All"):
            st.session_state["_reindex_all"] = True
            st.rerun()
    else:
        st.info("No documents indexed yet.")

# --- Main content ---
st.title("📄 Upload & Index Documentation")

if not ANTHROPIC_API_KEY:
    st.error("⚠️ ANTHROPIC_API_KEY not set.")
    st.markdown("""
    Add your API key to a `.env` file in the project root:
    ```
    ANTHROPIC_API_KEY=sk-ant-...
    ```
    Then restart the app.
    """)
    st.stop()

if "indexed_trees" not in st.session_state:
    st.session_state.indexed_trees = {}

# ============================================================
# Check for background indexing — each condition is independent
# ============================================================
bg_status = get_bg_status()

# Show errors first (regardless of running/complete state)
if bg_status["error"]:
    error_msg = bg_status["error"]
    if "credit balance" in error_msg.lower():
        st.error("⚠️ **Anthropic API credit balance is too low.** Add credits at [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing).")
    else:
        st.error(f"⚠️ **Indexing error:** {error_msg[:300]}")
    # Clear the error so it doesn't persist
    with _bg_lock:
        _bg_indexing["error"] = None
        _bg_indexing["complete"] = False

# Show progress if running
if bg_status["running"]:
    progress_pct = bg_status["progress"] / bg_status["total"] if bg_status["total"] > 0 else 0
    st.info(f"🔄 **Indexing in progress...** ({bg_status['progress']}/{bg_status['total']} files)")
    st.progress(progress_pct)
    st.caption(f"Currently processing: {bg_status['current_file']}")
    st.caption("You can switch pages — indexing continues in the background.")
    time.sleep(1.5)
    st.rerun()

# Collect completed results
if bg_status["complete"] and bg_status["results"]:
    for filename, result in bg_status["results"].items():
        st.session_state.indexed_trees[filename] = result
    with _bg_lock:
        _bg_indexing["results"] = {}
        _bg_indexing["complete"] = False
    st.toast(f"✅ Indexed {len(bg_status['results'])} files!", icon="🎉")
    # Clean up temp files if any
    if "_temp_upload_dir" in st.session_state:
        shutil.rmtree(st.session_state.pop("_temp_upload_dir"), ignore_errors=True)
    st.rerun()

# ============================================================
# Option 1: Load Sample Docs
# ============================================================
st.header("Quick Start: Sample Docs")
st.write("Load pre-built sample documentation to try OnboardBot immediately.")

col1, col2 = st.columns([1, 3])
with col1:
    load_samples = st.button("📦 Load Sample Docs", type="primary", disabled=bg_status["running"])

# Capture flag before popping
reindex_all = st.session_state.pop("_reindex_all", False)

if load_samples or reindex_all:
    if os.path.isdir(SAMPLE_DOCS_DIR):
        md_files = scan_directory(SAMPLE_DOCS_DIR)
        if md_files:
            for filepath in md_files:
                if not has_heading_structure(filepath):
                    st.warning(f"⚠️ {os.path.basename(filepath)} has no heading structure.")

            start_bg_indexing(md_files, force_reindex=reindex_all)
            st.info(f"🚀 Started indexing {len(md_files)} files in the background...")
            st.caption("You can switch to other pages — indexing will continue.")
            time.sleep(1)
            st.rerun()
        else:
            st.warning("No .md files found in sample_docs/")
    else:
        st.error(f"Sample docs directory not found: {SAMPLE_DOCS_DIR}")

st.divider()

# ============================================================
# Option 2: Upload Markdown Files
# ============================================================
st.header("Upload Your Docs")

uploaded_files = st.file_uploader(
    "Upload markdown files (.md)",
    type=["md", "markdown"],
    accept_multiple_files=True,
    help="Drag and drop or browse to select .md files",
)

if uploaded_files:
    if st.button("🔨 Build Index", type="primary", disabled=bg_status["running"]):
        # Save uploaded files to a temp directory (cleaned up after indexing completes)
        temp_dir = tempfile.mkdtemp(prefix="onboardbot_upload_")
        st.session_state["_temp_upload_dir"] = temp_dir
        temp_paths = []
        for uploaded_file in uploaded_files:
            dest = os.path.join(temp_dir, uploaded_file.name)
            try:
                content = uploaded_file.getvalue().decode("utf-8")
            except UnicodeDecodeError:
                st.warning(f"⚠️ {uploaded_file.name} is not valid UTF-8. Skipping.")
                continue
            with open(dest, "w", encoding="utf-8") as f:
                f.write(content)
            temp_paths.append(dest)

        if temp_paths:
            start_bg_indexing(temp_paths)
            st.info(f"🚀 Started indexing {len(temp_paths)} files in the background...")
            time.sleep(1)
            st.rerun()

st.divider()

# ============================================================
# Option 3: Folder Path
# ============================================================
st.header("Scan a Local Folder")

folder_path = st.text_input(
    "Paste an absolute path to a folder containing .md files:",
    placeholder="/path/to/your/project/docs",
)

if folder_path:
    if os.path.isdir(folder_path):
        md_files = scan_directory(folder_path)
        if md_files:
            st.write(f"Found {len(md_files)} markdown files:")

            selected_files = []
            for filepath in md_files:
                relative = os.path.relpath(filepath, folder_path)
                if st.checkbox(relative, value=True, key=f"scan_{filepath}"):
                    selected_files.append(filepath)

            if selected_files and st.button("🔨 Build Index from Selected", type="primary", disabled=bg_status["running"]):
                start_bg_indexing(selected_files)
                st.info(f"🚀 Started indexing {len(selected_files)} files in the background...")
                time.sleep(1)
                st.rerun()
        else:
            st.warning("No .md files found in this directory.")
    elif folder_path.strip():
        st.error("Directory not found. Please check the path.")

# ============================================================
# Summary
# ============================================================
st.divider()
st.header("Indexed Documents")

if st.session_state.indexed_trees:
    for filename, tree_data in st.session_state.indexed_trees.items():
        tree = tree_data.get("tree", tree_data)
        cached = tree_data.get("cached", False)
        badge = " *(cached)*" if cached else ""
        nodes = count_nodes(tree)
        desc = tree.get("doc_description", "")

        with st.expander(f"📄 **{tree.get('doc_name', filename)}** — {nodes} sections{badge}"):
            if desc:
                st.caption(desc)
            st.json({
                "doc_name": tree.get("doc_name"),
                "line_count": tree.get("line_count"),
                "sections": nodes,
                "indexed_at": tree_data.get("indexed_at", ""),
            })
else:
    st.info("No documents indexed yet. Use one of the options above to get started.")
