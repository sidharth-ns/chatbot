import streamlit as st

st.set_page_config(
    page_title="OnboardBot",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded",
)

# --- Sidebar ---
with st.sidebar:
    st.header("🤖 OnboardBot")
    st.caption("AI-Powered Onboarding Assistant")
    st.divider()

    trees = st.session_state.get("indexed_trees", {})
    if trees:
        from core.indexer import count_nodes
        total_files = len(trees)
        total_nodes = sum(count_nodes(t.get("tree", t)) for t in trees.values())
        st.success(f"📄 {total_files} files indexed ({total_nodes} sections)")
        for filename in trees:
            st.caption(f"  • {filename}")
    else:
        st.info("No documents indexed yet")

# --- Main content ---
st.title("🤖 OnboardBot")
st.subheader("Your AI-Powered Onboarding Assistant")

st.markdown("""
OnboardBot helps new team members get up to speed by providing an
intelligent chatbot that can answer questions about your project documentation.

It uses **PageIndex** — a vectorless, reasoning-based RAG pipeline that builds
hierarchical tree structures from your Markdown headings. No embeddings,
no vector database — just structured reasoning over your docs.
""")

st.divider()

st.markdown("### How It Works")

col1, col2, col3 = st.columns(3)

with col1:
    st.markdown("#### 1. Upload Docs")
    st.markdown("""
    Upload your Markdown documentation files
    or point to a local folder. PageIndex
    builds a tree structure from the headings.
    """)
    st.page_link("pages/1_Upload_Docs.py", label="📄 Upload Docs", icon="📄")

with col2:
    st.markdown("#### 2. Onboarding Checklist")
    st.markdown("""
    Walk through an interactive checklist
    to make sure your dev environment
    is set up correctly.
    """)
    st.page_link("pages/2_Chat.py", label="💬 Start Checklist", icon="✅")

with col3:
    st.markdown("#### 3. Chat with Docs")
    st.markdown("""
    Ask any question about the project.
    OnboardBot searches your docs and
    answers with source citations.
    """)
    st.page_link("pages/2_Chat.py", label="💬 Start Chatting", icon="💬")

st.divider()

# Status
trees = st.session_state.get("indexed_trees", {})
if trees:
    st.success(f"✅ **{len(trees)} document(s) indexed and ready.** Head to the Chat page to start asking questions.")
else:
    st.info("**Getting started:** Upload your project's Markdown docs on the Upload page, or load the sample docs to try it out.")

st.divider()

st.markdown("""
### Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd chatbot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
git clone https://github.com/VectifyAI/PageIndex.git lib/PageIndex

# 2. Set your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# 3. Run the app
streamlit run streamlit_app.py
```
""")
