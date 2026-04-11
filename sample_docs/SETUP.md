# Development Setup Guide

This guide covers everything needed to run TaskFlow locally. TaskFlow is a project
management platform built with FastAPI, React, PostgreSQL, and Redis.

---

## Prerequisites

Follow each section in order. All instructions assume macOS or Linux (Windows users
should use WSL2).

### System Requirements

- **OS**: macOS 12+, Ubuntu 20.04+, or Windows 11 with WSL2
- **RAM**: 8 GB minimum, 16 GB recommended
- **Disk**: 5 GB free for dependencies, database, and Docker images

### Required Software

| Software   | Min Version | Check Command            |
|------------|-------------|--------------------------|
| Python     | 3.11        | `python3 --version`      |
| Node.js    | 18.0        | `node --version`         |
| PostgreSQL | 15.0        | `psql --version`         |
| Redis      | 7.0         | `redis-server --version` |
| Docker     | 24.0        | `docker compose version` |
| Git        | 2.30        | `git --version`          |

### Recommended IDE Setup

We recommend VS Code with these extensions for linting, formatting, and debugging
that matches our CI pipeline.

- `ms-python.python`, `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`
- `bradlc.vscode-tailwindcss`, `ms-azuretools.vscode-docker`

A shared `.vscode/settings.json` is included with format-on-save and venv paths
pre-configured.

---

## Installation

### Step 1: Clone the Repository

```bash
git clone git@github.com:taskflow-team/taskflow.git
cd taskflow
```

External contributors should fork first, then add the upstream remote.

```bash
git remote add upstream git@github.com:taskflow-team/taskflow.git
```

### Step 2: Install Backend Dependencies

The backend uses Python 3.11+ with `venv`. All dependencies are pinned in
`requirements.txt`.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt -r requirements-dev.txt
```

### Step 3: Install Frontend Dependencies

The frontend is a React 18 app. Use `npm ci` for deterministic installs from the
lockfile.

```bash
cd frontend
npm ci
```

### Step 4: Database Setup

TaskFlow uses PostgreSQL 15+ as its primary data store.

#### Install PostgreSQL

```bash
# macOS
brew install postgresql@15 && brew services start postgresql@15

# Ubuntu
sudo apt-get install -y postgresql-15 postgresql-client-15
sudo systemctl enable --now postgresql
```

#### Create Database

Create a dedicated database and user. These credentials match `.env.example`.

```bash
psql -U postgres <<SQL
CREATE USER taskflow_user WITH PASSWORD 'taskflow_dev_pass';
CREATE DATABASE taskflow_db OWNER taskflow_user;
GRANT ALL PRIVILEGES ON DATABASE taskflow_db TO taskflow_user;
SQL
```

#### Run Migrations

TaskFlow uses Alembic for schema migrations. Run all pending migrations from the
backend directory.

```bash
cd backend && source .venv/bin/activate
alembic upgrade head
alembic current   # verify migration state
```

### Step 5: Redis Setup

Redis handles session caching, rate limiting, and the Celery task queue.

```bash
# macOS
brew install redis && brew services start redis

# Ubuntu
sudo apt-get install -y redis-server && sudo systemctl enable --now redis-server
```

Verify with `redis-cli ping` (expected output: `PONG`). The default config connects
to `localhost:6379` with no password.

### Step 6: Environment Variables

TaskFlow loads a `.env` file from the project root during development.

#### Required Variables

The backend refuses to start if any of these are missing.

- `DATABASE_URL` -- PostgreSQL connection string
- `REDIS_URL` -- Redis connection string
- `SECRET_KEY` -- 64-character hex string for JWT signing
- `ALLOWED_ORIGINS` -- Comma-separated CORS origins

#### Optional Variables

These have sensible defaults but can be overridden.

- `LOG_LEVEL` -- defaults to `INFO`
- `CELERY_CONCURRENCY` -- worker count, defaults to `4`
- `RATE_LIMIT_PER_MINUTE` -- per-user API limit, defaults to `60`
- `SENTRY_DSN` -- error tracking, disabled if unset

#### .env Template

```bash
cp .env.example .env
openssl rand -hex 32   # generate SECRET_KEY
```

Minimal local `.env`:

```env
DATABASE_URL=postgresql://taskflow_user:taskflow_dev_pass@localhost:5432/taskflow_db
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=your_generated_hex_string_here
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
LOG_LEVEL=DEBUG
```

---

## Running the Application

### Backend Server

Start FastAPI with Uvicorn and auto-reload on port 8000.

```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs are available at `http://localhost:8000/docs` (Swagger) and `/redoc`.

### Frontend Dev Server

Vite proxies API requests to the backend automatically.

```bash
cd frontend
npm run dev
```

The app is served at `http://localhost:5173` with hot module replacement.

### Running Both with Docker Compose

Spin up the entire stack (backend, frontend, PostgreSQL, Redis) in containers.

```bash
docker compose up --build          # foreground
docker compose up -d --build       # detached
docker compose logs -f backend     # stream logs
docker compose down -v             # stop and clean up
```

### Running Tests

All tests must pass before merging pull requests.

#### Backend Tests

Uses pytest with coverage. Tests run against an auto-created test database.

```bash
cd backend && source .venv/bin/activate
pytest --cov=app --cov-report=term-missing -v
pytest tests/test_projects.py::test_create_project -v   # single test
```

#### Frontend Tests

Uses Vitest and React Testing Library.

```bash
cd frontend
npm run test -- --coverage
npm run test:watch                 # watch mode
```

#### Integration Tests

End-to-end tests require the full stack running via Docker Compose.

```bash
docker compose -f docker-compose.test.yml up -d
cd backend && source .venv/bin/activate
pytest tests/integration/ -v --timeout=60
docker compose -f docker-compose.test.yml down -v
```

---

## Common Issues & Troubleshooting

### Port Already in Use

Find and kill the blocking process.

```bash
lsof -i :8000
kill -9 <PID>
```

Or start the service on a different port with `--port`.

### Database Connection Errors

Verify in order:

1. PostgreSQL is running: `pg_isready -h localhost -p 5432`
2. Database exists: `psql -U postgres -l | grep taskflow_db`
3. `DATABASE_URL` in `.env` matches the credentials you created
4. `pg_hba.conf` allows local password authentication

### Environment Variable Issues

Common symptoms: `ValidationError` on startup or `None` in config values. Check that
the `.env` file is in the project root (not `backend/` or `frontend/`), values have no
trailing spaces or quotes, and the `SECRET_KEY` is exactly 64 hex characters.

```bash
cd backend && source .venv/bin/activate
python -m app.utils.validate_env
```

### Docker Issues

```bash
docker system prune -f                 # clean dangling resources
docker compose build --no-cache        # rebuild from scratch
docker compose ps && docker compose logs --tail=50
```

On Linux permission errors, add your user to the `docker` group.

```bash
sudo usermod -aG docker $USER && newgrp docker
```
