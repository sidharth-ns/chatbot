import os
from dotenv import load_dotenv

load_dotenv()


def _get_secret(key: str, default: str = "") -> str:
    """Read from env vars first, then Streamlit secrets (for Streamlit Cloud)."""
    val = os.getenv(key, "")
    if val:
        return val
    try:
        import streamlit as st
        return st.secrets.get(key, default)
    except Exception:
        return default


ANTHROPIC_API_KEY = _get_secret("ANTHROPIC_API_KEY")
OPENAI_API_KEY = _get_secret("OPENAI_API_KEY")

# Model for PageIndex tree generation (litellm format — prefix with provider)
# Haiku is 5-10x faster than Sonnet for summary generation, and quality is sufficient
PAGEINDEX_MODEL = _get_secret("PAGEINDEX_MODEL", "anthropic/claude-haiku-4-5-20251001")

# Model for chat responses (anthropic SDK format — no prefix)
CHAT_MODEL = _get_secret("CHAT_MODEL", "claude-sonnet-4-20250514")

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "pageindex_cache")
SAMPLE_DOCS_DIR = os.path.join(BASE_DIR, "sample_docs")
