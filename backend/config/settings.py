"""
Application settings using pydantic-settings.

Re-exports key constants at module level for backward compatibility
with existing core modules that do `from config.settings import X`.
"""

import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = "postgresql+asyncpg://postgres:admin@localhost:5432/onboardbot"
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    PAGEINDEX_MODEL: str = "anthropic/claude-sonnet-4-20250514"
    CHAT_MODEL: str = "claude-sonnet-4-20250514"

    # Upload / indexing limits
    max_upload_size_mb: int = 10
    allowed_index_paths: list[str] = []

    # Paths
    BASE_DIR: str = os.path.dirname(os.path.dirname(__file__))
    CACHE_DIR: str = ""
    SAMPLE_DOCS_DIR: str = ""

    def model_post_init(self, __context: object) -> None:
        if not self.CACHE_DIR:
            self.CACHE_DIR = os.path.join(self.BASE_DIR, "pageindex_cache")
        if not self.SAMPLE_DOCS_DIR:
            self.SAMPLE_DOCS_DIR = os.path.join(self.BASE_DIR, "sample_docs")


settings = Settings()

# ── Re-export at module level for backward compatibility ──
ANTHROPIC_API_KEY = settings.ANTHROPIC_API_KEY
CHAT_MODEL = settings.CHAT_MODEL
PAGEINDEX_MODEL = settings.PAGEINDEX_MODEL
SAMPLE_DOCS_DIR = settings.SAMPLE_DOCS_DIR
CACHE_DIR = settings.CACHE_DIR
DATABASE_URL = settings.DATABASE_URL
