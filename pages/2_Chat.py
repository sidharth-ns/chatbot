import streamlit as st

st.set_page_config(page_title="Chat - OnboardBot", page_icon="🤖", layout="wide")

from config.settings import ANTHROPIC_API_KEY
from core.chat import stream_chat_response, generate_starter_questions, generate_followup_questions
from core.checklist import (
    load_config,
    init_state,
    get_current_question,
    mark_answered,
    get_progress,
    is_complete,
    skip_checklist,
    reset_checklist,
    get_help_content,
)

# Initialize session state
init_state(st.session_state)
if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
if "followups" not in st.session_state:
    st.session_state.followups = []
if "last_sources" not in st.session_state:
    st.session_state.last_sources = []

trees = st.session_state.get("indexed_trees", {})

# --- Sidebar ---
with st.sidebar:
    st.header("🤖 OnboardBot")
    st.divider()

    # Indexed docs status
    if trees:
        from core.indexer import count_nodes
        total_files = len(trees)
        total_nodes = sum(count_nodes(t.get("tree", t)) for t in trees.values())
        st.success(f"📄 {total_files} files indexed ({total_nodes} sections)")
    else:
        st.warning("No documents indexed")
        st.page_link("pages/1_Upload_Docs.py", label="Go to Upload Docs", icon="📄")

    st.divider()

    # Checklist progress
    if not is_complete(st.session_state):
        completed, total = get_progress(st.session_state)
        st.subheader("Onboarding Progress")
        st.progress(completed / total if total > 0 else 0)
        st.caption(f"✅ Onboarding: {completed}/{total} complete")

        if st.button("⏭️ Skip Checklist"):
            skip_checklist(st.session_state)
            st.rerun()
    else:
        completed, total = get_progress(st.session_state)
        st.subheader("Onboarding Progress")
        st.progress(1.0)
        st.caption(f"✅ Onboarding complete!")

    st.divider()

    # Reset buttons
    if st.button("🔄 Reset Checklist"):
        reset_checklist(st.session_state)
        st.rerun()

    if st.button("🗑️ Clear Chat"):
        st.session_state.chat_history = []
        st.session_state.followups = []
        st.session_state.last_sources = []
        st.rerun()

# --- Main content ---
st.title("💬 OnboardBot Chat")

# Validate
if not ANTHROPIC_API_KEY:
    st.error("⚠️ ANTHROPIC_API_KEY not set. Add it to your `.env` file.")
    st.stop()

if not trees:
    st.warning("No documents indexed yet. Please upload docs first.")
    st.page_link("pages/1_Upload_Docs.py", label="📄 Go to Upload Docs", icon="📄")
    st.stop()


# ============================================================
# Phase A: Onboarding Checklist Flow
# ============================================================
if not is_complete(st.session_state):
    config = load_config()

    # Show welcome message at start
    if not st.session_state.checklist_messages:
        st.session_state.checklist_messages.append({
            "role": "assistant",
            "content": config["welcome_message"],
        })

    # Display checklist conversation
    for msg in st.session_state.checklist_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    # Get current question
    current_q = get_current_question(st.session_state)

    if current_q:
        # Show the question
        with st.chat_message("assistant"):
            st.markdown(f"**{current_q['question']}**")

            col1, col2, col3 = st.columns([1, 1, 6])
            with col1:
                yes_clicked = st.button("✅ Yes", key=f"yes_{current_q['id']}", type="primary")
            with col2:
                no_clicked = st.button("❌ No", key=f"no_{current_q['id']}")

        if yes_clicked:
            # Record answer and move on
            st.session_state.checklist_messages.append({
                "role": "user",
                "content": f"✅ Yes — {current_q['question']}",
            })
            st.session_state.checklist_messages.append({
                "role": "assistant",
                "content": "Great! ✅ Moving on...",
            })
            mark_answered(st.session_state, current_q["id"], "yes")
            st.rerun()

        if no_clicked:
            # Get help content
            help_content = get_help_content(current_q, trees)

            # Build response
            response_parts = [help_content["message"]]

            if help_content["command"]:
                response_parts.append(f"\n```bash\n{help_content['command']}\n```")

            if help_content["link"]:
                response_parts.append(f"\n🔗 [{help_content['link']}]({help_content['link']})")

            if help_content["doc_content"]:
                response_parts.append(f"\n📚 **From your project docs:**\n\n{help_content['doc_content']}")

            full_response = "\n".join(response_parts)

            st.session_state.checklist_messages.append({
                "role": "user",
                "content": f"❌ No — {current_q['question']}",
            })
            st.session_state.checklist_messages.append({
                "role": "assistant",
                "content": full_response,
            })
            mark_answered(st.session_state, current_q["id"], "no")
            st.rerun()

    else:
        # All questions answered — show completion
        with st.chat_message("assistant"):
            st.markdown(config["completion_message"])
            st.balloons()
        # Mark complete by checking — is_complete should now return True
        st.rerun()

    st.stop()  # Don't show chat interface during checklist


# ============================================================
# Phase B: Free-form Chat
# ============================================================

# Display chat history
for i, msg in enumerate(st.session_state.chat_history):
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

        # Show sources after assistant messages
        if msg["role"] == "assistant" and msg.get("sources"):
            sources = msg["sources"]
            files_set = set(s["file_name"] for s in sources)
            with st.expander(f"📚 Sources ({len(sources)} sections from {len(files_set)} files)"):
                for s in sources:
                    st.markdown(f"**{s['file_name']}** > {s['heading_path']}")
                    snippet = s.get("content", "")[:200]
                    if snippet:
                        st.caption(f'"{snippet}..."')
                    st.divider()

        # Show follow-up questions after the last assistant message
        if msg["role"] == "assistant" and i == len(st.session_state.chat_history) - 1:
            if st.session_state.followups:
                cols = st.columns(len(st.session_state.followups))
                for j, q in enumerate(st.session_state.followups):
                    with cols[j]:
                        if st.button(q, key=f"followup_{i}_{j}"):
                            st.session_state.pending_question = q
                            st.rerun()

# Starter questions (show when chat is empty)
if not st.session_state.chat_history:
    st.markdown("**💡 Suggested questions to get started:**")
    try:
        suggestions = generate_starter_questions(trees)
    except Exception:
        suggestions = [
            "What is this project about?",
            "How do I set up my development environment?",
            "What's the project architecture?",
        ]

    # Show up to 3 in a row, then next 3
    for row_start in range(0, len(suggestions), 3):
        row = suggestions[row_start : row_start + 3]
        cols = st.columns(len(row))
        for j, q in enumerate(row):
            with cols[j]:
                if st.button(q, key=f"starter_{row_start + j}"):
                    st.session_state.pending_question = q
                    st.rerun()

# Handle pending question (from suggestions or follow-ups)
pending = st.session_state.pop("pending_question", None)

# Chat input
prompt = pending or st.chat_input("Ask about the project documentation...")

if prompt:
    # Display and store user message
    st.session_state.chat_history.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # Prepare messages for Claude (role + content only)
    api_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in st.session_state.chat_history
    ]

    # Stream response with RAG
    with st.chat_message("assistant"):
        with st.spinner("Searching documentation..."):
            stream, sources = stream_chat_response(
                messages=api_messages,
                indexed_trees=trees,
            )

        response_text = st.write_stream(stream)

    # Store response with sources
    st.session_state.chat_history.append({
        "role": "assistant",
        "content": response_text,
        "sources": sources,
    })
    st.session_state.last_sources = sources

    # Show sources
    if sources:
        files_set = set(s["file_name"] for s in sources)
        with st.expander(f"📚 Sources ({len(sources)} sections from {len(files_set)} files)"):
            for s in sources:
                st.markdown(f"**{s['file_name']}** > {s['heading_path']}")
                snippet = s.get("content", "")[:200]
                if snippet:
                    st.caption(f'"{snippet}..."')
                st.divider()

    # Generate follow-up questions
    try:
        followups = generate_followup_questions(prompt, response_text)
        st.session_state.followups = followups
        if followups:
            cols = st.columns(len(followups))
            for j, q in enumerate(followups):
                with cols[j]:
                    if st.button(q, key=f"followup_new_{j}"):
                        st.session_state.pending_question = q
                        st.rerun()
    except Exception:
        st.session_state.followups = []
