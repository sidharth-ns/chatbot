# TaskFlow -- Project Management Platform

TaskFlow is a modern, collaborative project management platform designed for engineering teams
that need visibility into complex workflows. It combines real-time task tracking, sprint planning,
and resource allocation into a single, fast interface built for teams of 5 to 500.

---

## Overview

TaskFlow helps product and engineering teams plan sprints, track progress, and ship software
on time. It replaces spreadsheets, sticky notes, and disconnected tools with a unified workspace
where every task, conversation, and decision lives in one place.

Key capabilities include:

- **Kanban and Sprint Boards** with drag-and-drop task management
- **Timeline View** for tracking dependencies across teams and milestones
- **Workload Balancing** with automatic capacity calculations per team member
- **Custom Workflows** that adapt to your team's process, not the other way around
- **Real-Time Collaboration** with live cursors, comments, and presence indicators
- **REST and WebSocket APIs** for integrating with CI/CD pipelines, Slack, and GitHub

TaskFlow is designed for self-hosted deployments as well as our managed cloud offering.

---

## Tech Stack

### Frontend

The frontend is a single-page application built with React 18 and TypeScript. State management
is handled by Zustand for local UI state and TanStack Query for server state and caching.
Styling uses Tailwind CSS with a custom design token system defined in `tailwind.config.ts`.

Key frontend libraries:

| Library            | Purpose                          |
| ------------------ | -------------------------------- |
| React 18           | UI framework                     |
| TypeScript 5.3     | Type safety                      |
| Zustand            | Client-side state management     |
| TanStack Query v5  | Server state and caching         |
| Tailwind CSS 3.4   | Utility-first styling            |
| Radix UI           | Accessible headless primitives   |
| Vitest + RTL       | Unit and component testing       |
| Playwright         | End-to-end testing               |

### Backend

The backend is a Python 3.12 application built with FastAPI. It exposes a RESTful API
documented with OpenAPI and served by Uvicorn. Background jobs (email notifications,
report generation, webhook deliveries) are processed by Celery workers backed by Redis.

```
backend/
  app/
    api/          # Route handlers organized by domain
    core/         # Settings, security, middleware
    models/       # SQLAlchemy ORM models
    schemas/      # Pydantic request/response schemas
    services/     # Business logic layer
    tasks/        # Celery async task definitions
  alembic/        # Database migration scripts
  tests/          # Pytest test suite
```

### Database

TaskFlow uses PostgreSQL 16 as its primary data store. The schema is managed through
Alembic migrations, and the ORM layer is SQLAlchemy 2.0 with its async session API.
Redis 7 handles Celery task brokering, query caching, and the WebSocket pub/sub layer
that drives real-time updates. Connection pooling uses SQLAlchemy's built-in pool:

```python
# backend/app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
```

### Infrastructure

Production deployments run on Kubernetes (EKS) with Helm charts in the `infra/` directory.
CI/CD uses GitHub Actions with separate workflows for linting, testing, building images,
and deploying. Observability is provided by OpenTelemetry traces (Jaeger) and Prometheus
metrics (Grafana).

---

## Quick Start

### Prerequisites

Make sure you have the following tools installed before proceeding:

- **Node.js** >= 20.x and **pnpm** >= 9.x (for the frontend)
- **Python** >= 3.12 and **uv** >= 0.4 (for the backend)
- **PostgreSQL** >= 16 (local install or Docker)
- **Redis** >= 7 (local install or Docker)
- **Docker** and **Docker Compose** (optional, but recommended)

### Installation

Clone the repository and install dependencies for both the frontend and backend:

```bash
git clone https://github.com/taskflow-io/taskflow.git
cd taskflow

cd frontend && pnpm install     # Install frontend deps
cd ../backend && uv sync        # Install backend deps
```

Copy the example environment files and fill in your local values:

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

At minimum, you need to set `DATABASE_URL` and `REDIS_URL` in `backend/.env`:

```env
DATABASE_URL=postgresql+asyncpg://taskflow:taskflow@localhost:5432/taskflow
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=change-me-in-production
```

### Running Locally

Start the backend API server and Celery worker in separate terminals:

```bash
# Terminal 1 — API server
cd backend
uv run uvicorn app.main:app --reload --port 8000

# Terminal 2 — Celery worker
cd backend
uv run celery -A app.tasks.worker worker --loglevel=info

# Terminal 3 — Frontend dev server
cd frontend
pnpm dev
```

The frontend will be available at `http://localhost:5173` and the API at
`http://localhost:8000`. Interactive API docs are served at `http://localhost:8000/docs`.

Before first use, run the database migrations and seed script:

```bash
cd backend
uv run alembic upgrade head
uv run python -m app.scripts.seed_data
```

This creates a demo workspace with sample projects, tasks, and a test user
(`admin@taskflow.local` / `taskflow123`).

### Running with Docker

The easiest way to get the full stack running is with Docker Compose. A single command
brings up the API, frontend, PostgreSQL, Redis, and a Celery worker:

```bash
docker compose up --build
```

This brings up five services: `frontend` (port 5173), `api` (port 8000), `worker` (Celery),
`postgres` (port 5432), and `redis` (port 6379). To tear everything down and remove volumes:

```bash
docker compose down -v
```

---

## Project Structure

Below is a high-level view of the repository layout:

```
taskflow/
  frontend/               # React SPA (TypeScript, Vite, Tailwind)
    src/
      components/         # Shared UI components (buttons, modals, forms)
      features/           # Feature modules (boards, timeline, settings)
      hooks/              # Custom React hooks
      lib/                # API client, utilities, constants
      pages/              # Route-level page components
      stores/             # Zustand state stores
    e2e/                  # Playwright end-to-end tests

  backend/                # FastAPI application (Python 3.12)
    app/
      api/                # Versioned route handlers (/v1/projects, /v1/tasks)
      core/               # Config, auth, middleware, database setup
      models/             # SQLAlchemy ORM models
      schemas/            # Pydantic validation schemas
      services/           # Business logic (project_service, task_service)
      tasks/              # Celery tasks (notifications, reports, webhooks)
    alembic/              # Database migrations
    tests/                # Pytest unit and integration tests

  infra/                  # Infrastructure and deployment
    helm/                 # Helm chart for Kubernetes deployment
    terraform/            # Terraform modules for AWS resources

  docs/                   # Project documentation (MkDocs)
  docker-compose.yml      # Local development orchestration
  Makefile                # Common task shortcuts
```

The `Makefile` at the root provides shortcuts for the most common development tasks:

```bash
make install       # Install all dependencies (frontend + backend)
make dev           # Start the full local stack via Docker Compose
make test          # Run all tests (frontend + backend)
make lint          # Run linters and formatters
make migrate       # Run pending database migrations
make seed          # Seed the database with demo data
```

---

## Contributing

We welcome contributions from the community. Before opening a pull request, please read
our [Contributing Guide](./CONTRIBUTING.md) which covers the branching strategy, commit
message conventions, code review process, and how to run the test suite locally.

In short:

1. Fork the repository and create a feature branch from `main`.
2. Write tests for any new functionality or bug fixes.
3. Ensure `make lint` and `make test` pass before pushing.
4. Open a pull request with a clear description of what changed and why.

If you find a bug or have a feature request, please open an issue using the appropriate
template in the GitHub issue tracker.

---

## License

TaskFlow is released under the [MIT License](./LICENSE). You are free to use, modify, and
distribute this software in accordance with the terms of that license. See the `LICENSE`
file at the root of this repository for the full text.
