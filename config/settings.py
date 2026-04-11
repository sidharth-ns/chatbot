import os
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Model for PageIndex tree generation (litellm format — prefix with provider)
PAGEINDEX_MODEL = os.getenv("PAGEINDEX_MODEL", "anthropic/claude-sonnet-4-20250514")

# Model for chat responses (anthropic SDK format — no prefix)
CHAT_MODEL = os.getenv("CHAT_MODEL", "claude-sonnet-4-20250514")

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "pageindex_cache")
SAMPLE_DOCS_DIR = os.path.join(BASE_DIR, "sample_docs")
