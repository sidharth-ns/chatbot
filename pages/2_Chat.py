import streamlit as st
import time

st.set_page_config(page_title="Chat - OnboardBot", page_icon="🤖", layout="wide")

from config.settings import ANTHROPIC_API_KEY
from core.chat import (
    stream_chat_response, generate_starter_questions, generate_followup_questions,
    get_bg_chat_status, start_bg_chat, clear_bg_chat,
)
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
if "starter_questions" not in st.session_state:
    st.session_state.starter_questions = None

trees = st.session_state.get("indexed_trees", {})

# --- Sidebar ---
with st.sidebar:
    st.header("🤖 OnboardBot")
    st.divider()

    if trees:
        from core.indexer import count_nodes
        total_files = len(trees)
        total_nodes = sum(count_nodes(t.get("tree", t)) for t in trees.values())
        st.success(f"📄 {total_files} files indexed ({total_nodes} sections)")
    else:
        st.warning("No documents indexed")
        st.page_link("pages/1_Upload_Docs.py", label="Go to Upload Docs", icon="📄")

    st.divider()

    if not is_complete(st.session_state):
        completed, total = get_progress(st.session_state)
        st.subheader("Onboarding Progress")
        st.progress(completed / total if total > 0 else 0)
        st.caption(f"✅ Onboarding: {completed}/{total} complete")

        if st.button("⏭️ Skip Checklist"):
            skip_checklist(st.session_state)
            st.rerun()
    else:
        st.subheader("Onboarding Progress")
        st.progress(1.0)
        st.caption("✅ Onboarding complete!")

    st.divider()

    if st.button("🔄 Reset Checklist"):
        reset_checklist(st.session_state)
        st.rerun()

    if st.button("🗑️ Clear Chat"):
        st.session_state.chat_history = []
        st.session_state.followups = []
        st.session_state.starter_questions = None
        st.rerun()

# --- Main content ---
st.title("💬 OnboardBot Chat")

if not ANTHROPIC_API_KEY:
    st.error("⚠️ ANTHROPIC_API_KEY not set. Add it to your `.env` file.")
    st.stop()

if not trees:
    st.warning("No documents indexed yet. Please upload docs first.")
    st.page_link("pages/1_Upload_Docs.py", label="📄 Go to Upload Docs", icon="📄")
    st.stop()


# ============================================================
# Check for background chat response (from page switch)
# ============================================================
bg_chat = get_bg_chat_status()

if bg_chat["running"]:
    # Show waiting indicator
    st.info(f"🔄 **Generating response for:** \"{bg_chat['prompt'][:80]}...\"")
    st.caption("The response is being generated in the background. Please wait...")
    time.sleep(1.5)
    st.rerun()

if bg_chat["response"] is not None:
    # Collect background response into chat history
    st.session_state.chat_history.append({"role": "user", "content": bg_chat["prompt"]})
    st.session_state.chat_history.append({
        "role": "assistant",
        "content": bg_chat["response"],
        "sources": bg_chat["sources"],
    })
    st.session_state.followups = [q for q in bg_chat.get("followups", []) if isinstance(q, str) and q.strip()]
    clear_bg_chat()
    st.rerun()

if bg_chat["error"]:
    st.error(f"⚠️ **Background response failed:** {bg_chat['error'][:200]}")
    clear_bg_chat()


# ============================================================
# Phase A: Onboarding Checklist Flow
# ============================================================
if not is_complete(st.session_state):
    config = load_config()

    if not st.session_state.checklist_messages:
        st.session_state.checklist_messages.append({
            "role": "assistant",
            "content": config["welcome_message"],
        })

    for msg in st.session_state.checklist_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    current_q = get_current_question(st.session_state)

    if current_q:
        with st.chat_message("assistant"):
            st.markdown(f"**{current_q['question']}**")

            col1, col2, col3 = st.columns([1, 1, 6])
            with col1:
                yes_clicked = st.button("✅ Yes", key=f"yes_{current_q['id']}", type="primary")
            with col2:
                no_clicked = st.button("❌ No", key=f"no_{current_q['id']}")

        if yes_clicked:
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
            help_content = get_help_content(current_q, trees)
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
        with st.chat_message("assistant"):
            st.markdown(config["completion_message"])
        if st.button("🚀 Continue to Chat", type="primary"):
            st.rerun()

    st.stop()


# ============================================================
# Phase B: Free-form Chat
# ============================================================

# Display full chat history
for i, msg in enumerate(st.session_state.chat_history):
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

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

# Follow-up buttons
if st.session_state.chat_history and st.session_state.followups:
    last_msg = st.session_state.chat_history[-1]
    if last_msg["role"] == "assistant":
        valid_followups = [q for q in st.session_state.followups if isinstance(q, str) and q.strip()]
        if valid_followups:
            cols = st.columns(len(valid_followups))
            for j, q in enumerate(valid_followups):
                with cols[j]:
                    if st.button(q, key=f"followup_{j}"):
                        st.session_state.pending_question = q
                        st.rerun()

# Starter questions
DEFAULT_STARTERS = [
    "What is this project about?",
    "How do I set up my development environment?",
    "What's the project architecture?",
    "How do I run the tests?",
    "What's the contribution workflow?",
    "How does authentication work?",
]

if not st.session_state.chat_history:
    st.markdown("**💡 Suggested questions to get started:**")

    if st.session_state.starter_questions is None:
        try:
            custom = generate_starter_questions(trees)
            if custom:
                st.session_state.starter_questions = custom
            else:
                st.session_state.starter_questions = DEFAULT_STARTERS
        except Exception:
            st.session_state.starter_questions = DEFAULT_STARTERS

    suggestions = st.session_state.starter_questions
    for row_start in range(0, len(suggestions), 3):
        row = suggestions[row_start : row_start + 3]
        cols = st.columns(len(row))
        for j, q in enumerate(row):
            with cols[j]:
                if st.button(q, key=f"starter_{row_start + j}"):
                    st.session_state.pending_question = q
                    st.rerun()

# Handle pending question
pending = st.session_state.pop("pending_question", None)

# Chat input
prompt = pending or st.chat_input("Ask about the project documentation...")

if prompt:
    # Show user message
    with st.chat_message("user"):
        st.markdown(prompt)

    # Build API messages
    api_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in st.session_state.chat_history
    ] + [{"role": "user", "content": prompt}]

    # Start background response (survives page switches)
    start_bg_chat(api_messages, trees, prompt)

    # Try to stream the response on this page
    with st.chat_message("assistant"):
        try:
            with st.spinner("Searching documentation..."):
                stream, sources = stream_chat_response(
                    messages=api_messages,
                    indexed_trees=trees,
                )

            response_text = st.write_stream(stream)
        except Exception as e:
            error_msg = str(e)
            if "credit balance" in error_msg.lower() or "billing" in error_msg.lower():
                st.error("⚠️ **Anthropic API credit balance is too low.** Please add credits at [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing).")
            elif "authentication" in error_msg.lower() or "api-key" in error_msg.lower() or "api_key" in error_msg.lower():
                st.error("⚠️ **Invalid API key.** Please check your ANTHROPIC_API_KEY in settings/secrets.")
            else:
                st.error(f"⚠️ **API Error:** {error_msg[:200]}")
            st.stop()

    # Streaming completed — commit to history and clear background task
    if response_text:
        st.session_state.chat_history.append({"role": "user", "content": prompt})
        st.session_state.chat_history.append({
            "role": "assistant",
            "content": response_text,
            "sources": sources,
        })
        clear_bg_chat()  # Cancel background since we got the response via streaming

        # Cap chat history
        if len(st.session_state.chat_history) > 50:
            st.session_state.chat_history = st.session_state.chat_history[-50:]

        # Generate follow-up questions
        try:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(generate_followup_questions, prompt, response_text)
                try:
                    followups = future.result(timeout=3)
                except Exception:
                    followups = []
            st.session_state.followups = [q for q in followups if isinstance(q, str) and q.strip()]
        except Exception:
            st.session_state.followups = []

        st.rerun()
