import streamlit as st
import os
import tempfile
from datetime import datetime, timezone

st.set_page_config(page_title="Upload Docs - OnboardBot", page_icon="🤖", layout="wide")

from config.settings import ANTHROPIC_API_KEY, SAMPLE_DOCS_DIR
from core.indexer import index_markdown_file, scan_directory, count_nodes, has_heading_structure

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
                def render_toc(nodes, indent=0):
                    for node in nodes:
                        prefix = "&nbsp;" * indent * 4
                        nid = node.get("node_id", "")
                        title = node.get("title", "")
                        st.markdown(f"{prefix}`{nid}` {title}", unsafe_allow_html=True)
                        if node.get("nodes"):
                            render_toc(node["nodes"], indent + 1)
                render_toc(tree.get("structure", []))

                # Individual re-index button
                if st.button(f"Re-index", key=f"reindex_{filename}"):
                    st.session_state[f"_reindex_{filename}"] = True
                    st.rerun()

        st.divider()
        if st.button("🔄 Re-index All"):
            st.session_state["_reindex_all"] = True
            st.rerun()
    else:
        st.info("No documents indexed yet.")

# --- Main content ---
st.title("📄 Upload & Index Documentation")

# Validate API key
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

# Initialize session state
if "indexed_trees" not in st.session_state:
    st.session_state.indexed_trees = {}

# ============================================================
# Option 1: Load Sample Docs
# ============================================================
st.header("Quick Start: Sample Docs")
st.write("Load pre-built sample documentation to try OnboardBot immediately.")

col1, col2 = st.columns([1, 3])
with col1:
    load_samples = st.button("📦 Load Sample Docs", type="primary")

if load_samples or st.session_state.get("_reindex_all"):
    st.session_state.pop("_reindex_all", None)

    if os.path.isdir(SAMPLE_DOCS_DIR):
        md_files = scan_directory(SAMPLE_DOCS_DIR)
        if md_files:
            with st.status(f"Indexing {len(md_files)} files...", expanded=True) as status:
                progress = st.progress(0)
                for i, filepath in enumerate(md_files):
                    filename = os.path.basename(filepath)

                    # Check heading structure
                    if not has_heading_structure(filepath):
                        st.warning(f"⚠️ {filename} has no heading structure. PageIndex works best with properly structured Markdown using #, ##, ### headings.")

                    st.write(f"Processing {filename}...")
                    force = st.session_state.get("_reindex_all", False)
                    result = index_markdown_file(filepath, force_reindex=force)
                    st.session_state.indexed_trees[filename] = result
                    progress.progress((i + 1) / len(md_files))

                status.update(label=f"✅ Indexed {len(md_files)} files!", state="complete")
            st.toast(f"✅ Indexed {len(md_files)} files!", icon="🎉")
            st.rerun()
        else:
            st.warning("No .md files found in sample_docs/")
    else:
        st.error(f"Sample docs directory not found: {SAMPLE_DOCS_DIR}")

# Handle individual re-index
for filename in list(st.session_state.get("indexed_trees", {}).keys()):
    if st.session_state.pop(f"_reindex_{filename}", False):
        tree_data = st.session_state.indexed_trees[filename]
        # Find original filepath
        filepath = os.path.join(SAMPLE_DOCS_DIR, filename)
        if os.path.exists(filepath):
            with st.spinner(f"Re-indexing {filename}..."):
                result = index_markdown_file(filepath, force_reindex=True)
                st.session_state.indexed_trees[filename] = result
            st.toast(f"✅ Re-indexed {filename}", icon="🔄")
            st.rerun()

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
    if st.button("🔨 Build Index", type="primary"):
        with st.status(f"Indexing {len(uploaded_files)} uploaded files...", expanded=True) as status:
            progress = st.progress(0)
            for i, uploaded_file in enumerate(uploaded_files):
                st.write(f"Processing {uploaded_file.name}...")

                # Write to temp file (md_to_tree needs a file path)
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".md", delete=False, encoding="utf-8"
                ) as tmp:
                    tmp.write(uploaded_file.getvalue().decode("utf-8"))
                    tmp_path = tmp.name

                try:
                    if not has_heading_structure(tmp_path):
                        st.warning(f"⚠️ {uploaded_file.name} has no heading structure. PageIndex works best with properly structured Markdown using #, ##, ### headings.")

                    result = index_markdown_file(tmp_path)
                    st.session_state.indexed_trees[uploaded_file.name] = result
                finally:
                    os.unlink(tmp_path)

                progress.progress((i + 1) / len(uploaded_files))

            status.update(label=f"✅ Indexed {len(uploaded_files)} files!", state="complete")
        st.toast(f"✅ Indexed {len(uploaded_files)} files!", icon="🎉")
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

            # Show files with checkboxes
            selected_files = []
            for filepath in md_files:
                relative = os.path.relpath(filepath, folder_path)
                if st.checkbox(relative, value=True, key=f"scan_{filepath}"):
                    selected_files.append(filepath)

            if selected_files and st.button("🔨 Build Index from Selected", type="primary"):
                with st.status(f"Indexing {len(selected_files)} files...", expanded=True) as status:
                    progress = st.progress(0)
                    for i, filepath in enumerate(selected_files):
                        filename = os.path.basename(filepath)
                        st.write(f"Processing {filename}...")

                        if not has_heading_structure(filepath):
                            st.warning(f"⚠️ {filename} has no heading structure.")

                        result = index_markdown_file(filepath)
                        st.session_state.indexed_trees[filename] = result
                        progress.progress((i + 1) / len(selected_files))

                    status.update(label=f"✅ Indexed {len(selected_files)} files!", state="complete")
                st.toast(f"✅ Indexed {len(selected_files)} files!", icon="🎉")
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
