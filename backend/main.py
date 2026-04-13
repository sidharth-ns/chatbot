"""
FastAPI application entry-point for OnboardBot backend.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from models.database import async_session
from routers import chat, checklist, upload

app = FastAPI(
    title="OnboardBot API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──
app.include_router(upload.router)
app.include_router(chat.router)
app.include_router(checklist.router)


# ── Health check ──
@app.get("/api/health")
async def health():
    """Returns service status and database connectivity."""
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as exc:
        db_status = f"error: {exc}"

    return {"status": "ok", "db": db_status}
