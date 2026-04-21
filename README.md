# OnboardBot

AI-powered onboarding chatbot that helps new team members understand a project by chatting with its documentation.

**Next.js 14 frontend + FastAPI backend + PostgreSQL**

## Architecture

```
frontend/    Next.js 14 (App Router, Tailwind, shadcn/ui)
backend/     FastAPI (Python 3.11+, SQLAlchemy, Alembic)
PostgreSQL   Chat sessions, messages, documents, checklist state
```

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL running locally

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY and DATABASE_URL

# Run migrations
alembic upgrade head

# Start
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install

# Configure
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local

# Start
npm run dev
```

Open http://localhost:3000

### Docker Compose

```bash
docker-compose up --build
```

## Features

- Upload Markdown docs and index them with PageIndex (tree-based RAG)
- Chat with your docs — streaming responses with source citations
- Onboarding checklist for first-time users
- Session management with persistent chat history
- Stop streaming mid-response
- Follow-up question suggestions

## License

MIT
