# Architecture Overview

TaskFlow is a project management platform designed for mid-size engineering teams (10-200 members).
It provides task tracking, sprint planning, time estimation, and cross-team dependency management.
The system is built as a monolithic backend with a single-page application frontend, communicating
over a RESTful API with selective WebSocket channels for real-time updates. This document describes
the architecture decisions, component boundaries, and infrastructure that support the platform.

The primary design goals are low-latency task operations (sub-200ms p95 for reads), horizontal
scalability at the API layer, and strong data consistency for task state transitions. We favor
simplicity over microservice decomposition at this stage, with clear internal module boundaries
that allow future extraction if needed.

---

## System Design

### High-Level Architecture

The system follows a three-tier architecture with a clear separation between the presentation layer,
application logic, and data persistence. All client requests enter through an AWS Application Load
Balancer, which terminates TLS and routes traffic to ECS containers running the FastAPI backend.
The React frontend is served as a static bundle from CloudFront backed by S3.

```
                         +------------------+
                         |   CloudFront     |
                         |  (React SPA)     |
                         +--------+---------+
                                  |
                         +--------v---------+
                         |       ALB        |
                         | (TLS termination)|
                         +--------+---------+
                                  |
                    +-------------+-------------+
                    |                           |
           +--------v---------+       +--------v---------+
           |  FastAPI (ECS)   |       |  FastAPI (ECS)   |
           |  Container A     |       |  Container B     |
           +--------+---------+       +--------+---------+
                    |                           |
              +-----v---------------------------v-----+
              |            PostgreSQL (RDS)            |
              +-------------------+-------------------+
              |            Redis (ElastiCache)         |
              +---------------------------------------+
```

The backend containers are stateless. Session data and cache entries live in Redis. All durable
state resides in PostgreSQL. Celery workers run in separate ECS tasks sharing the same codebase
but configured with a different entrypoint.

### Request Flow

A typical authenticated request follows this path through the system:

1. The React client sends an HTTP request with a Bearer JWT in the Authorization header.
2. The ALB forwards the request to a healthy ECS task running the FastAPI application.
3. FastAPI middleware validates the JWT signature and expiration, attaching the decoded claims to the request state.
4. The router dispatches to the appropriate endpoint handler based on the URL path and HTTP method.
5. The endpoint calls into the service layer, which orchestrates business logic and repository calls.
6. The repository layer executes parameterized SQL queries against PostgreSQL via SQLAlchemy async sessions.
7. The response is serialized through a Pydantic model and returned as JSON.

For write operations that trigger side effects (e.g., sending notifications when a task is assigned),
the service layer enqueues a Celery task rather than performing the side effect inline. This keeps
request latency predictable and allows retries on transient failures.

---

## Frontend

### Component Structure

The frontend is a React 18 application written in TypeScript, bootstrapped with Vite. Components
are organized by feature domain rather than by technical role. Each feature folder contains its
page components, sub-components, hooks, and local types.

```
src/
  features/
    tasks/
      TaskListPage.tsx
      TaskDetailPage.tsx
      TaskCard.tsx
      useTaskFilters.ts
      types.ts
    sprints/
      SprintBoardPage.tsx
      SprintColumn.tsx
      useDragAndDrop.ts
    teams/
      TeamOverviewPage.tsx
      MemberAvatarGroup.tsx
  shared/
    components/
      Button.tsx
      Modal.tsx
      DataTable.tsx
    hooks/
      useDebounce.ts
      useIntersectionObserver.ts
    api/
      client.ts
      queryKeys.ts
```

Shared components follow a compound component pattern where appropriate (e.g., `DataTable` exposes
`DataTable.Header`, `DataTable.Row`, `DataTable.Cell`). All shared components accept a `className`
prop for style overrides and are documented with Storybook stories.

### State Management

Client state is managed with Zustand for lightweight global stores (UI preferences, sidebar state,
active filters). Server state is handled entirely by TanStack Query (React Query v5), which provides
caching, background refetching, and optimistic updates out of the box.

```typescript
// Example: Zustand store for UI preferences
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIPreferencesState {
  sidebarCollapsed: boolean;
  taskViewMode: 'list' | 'board' | 'timeline';
  toggleSidebar: () => void;
  setTaskViewMode: (mode: UIPreferencesState['taskViewMode']) => void;
}

export const useUIPreferences = create<UIPreferencesState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      taskViewMode: 'board',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTaskViewMode: (mode) => set({ taskViewMode: mode }),
    }),
    { name: 'taskflow-ui-prefs' }
  )
);
```

We avoid Redux intentionally. The combination of TanStack Query for server cache and Zustand for
small client-only slices covers our needs with far less boilerplate. Optimistic updates for task
mutations (drag-and-drop reordering, status changes) are implemented at the query level using
TanStack Query's `onMutate` / `onError` / `onSettled` callbacks.

### Routing

Routing uses React Router v6 with lazy-loaded route components. The top-level route configuration
lives in `src/router.tsx` and uses a data router with loaders for critical paths. Protected routes
are wrapped in an `AuthGuard` component that checks for a valid access token before rendering.

```typescript
const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      { path: 'tasks', lazy: () => import('./features/tasks/TaskListPage') },
      { path: 'tasks/:taskId', lazy: () => import('./features/tasks/TaskDetailPage') },
      { path: 'sprints', lazy: () => import('./features/sprints/SprintBoardPage') },
      { path: 'teams', lazy: () => import('./features/teams/TeamOverviewPage') },
      { path: 'settings/*', lazy: () => import('./features/settings/SettingsLayout') },
    ],
  },
  { path: '/login', lazy: () => import('./features/auth/LoginPage') },
  { path: '/invite/:token', lazy: () => import('./features/auth/InviteAcceptPage') },
]);
```

Route-level code splitting keeps the initial bundle under 180 KB gzipped. The `AppShell` component
renders the persistent sidebar navigation, top bar, and a Suspense boundary with a skeleton loader
for the active route content.

---

## Backend

### API Layer

The backend is a Python 3.12 application built with FastAPI 0.110+. API routes are organized into
versioned router modules under `app/api/v1/`. Each router module corresponds to a resource domain
and defines endpoints using FastAPI's dependency injection for authentication, pagination, and
database session management.

```python
# app/api/v1/tasks.py
from fastapi import APIRouter, Depends, Query
from app.auth.dependencies import get_current_user
from app.services.task_service import TaskService
from app.schemas.task import TaskListResponse, TaskCreate

router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.get("/", response_model=TaskListResponse)
async def list_tasks(
    project_id: int = Query(...),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    current_user=Depends(get_current_user),
    task_service: TaskService = Depends(),
):
    return await task_service.list_tasks(
        project_id=project_id,
        status=status,
        page=page,
        per_page=per_page,
        requester=current_user,
    )
```

Request validation is handled by Pydantic v2 models defined in `app/schemas/`. All API responses
follow a consistent envelope format with `data`, `meta` (pagination), and `errors` fields. Error
responses use RFC 7807 problem detail format with machine-readable error codes.

### Service Layer

The service layer contains all business logic and sits between the API endpoints and the data access
repositories. Each service class is instantiated per-request via FastAPI's dependency system and
receives its repository dependencies through constructor injection.

Services enforce invariants that span multiple aggregates. For example, `TaskService.transition_status`
validates that the requested status transition is legal according to the project's workflow
configuration before persisting the change. Services never import FastAPI-specific types, keeping
them testable in isolation with mock repositories.

Key services include `TaskService`, `SprintService`, `ProjectService`, `NotificationService`, and
`TimeTrackingService`. Cross-cutting concerns like audit logging are handled by a decorator
(`@audit_log`) applied at the service method level that records the before/after state of modified
entities.

### Database Layer

#### PostgreSQL Schema

The database runs PostgreSQL 15 on Amazon RDS with a Multi-AZ deployment. The schema uses a
multi-tenant design with a `workspace_id` foreign key on all user-facing tables rather than
schema-per-tenant isolation. Row-level security policies are not used; tenancy filtering is
enforced at the repository layer.

Core tables and their relationships:

```sql
CREATE TABLE workspaces (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(63) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES workspaces(id),
    name          VARCHAR(255) NOT NULL,
    key           VARCHAR(10) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, key)
);

CREATE TABLE tasks (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id),
    title         VARCHAR(500) NOT NULL,
    description   TEXT,
    status        VARCHAR(50) NOT NULL DEFAULT 'backlog',
    priority      SMALLINT NOT NULL DEFAULT 3,
    assignee_id   BIGINT REFERENCES users(id),
    sprint_id     BIGINT REFERENCES sprints(id),
    story_points  SMALLINT,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_tasks_sprint ON tasks(sprint_id) WHERE sprint_id IS NOT NULL;
```

Partial indexes are used extensively to keep index sizes small and scans fast. The `position` column
supports drag-and-drop ordering within a sprint column using a gapped integer strategy (positions
are spaced by 1000 and rebalanced in batch when gaps are exhausted).

#### Migrations

Database migrations are managed with Alembic. Migration files live in `alembic/versions/` and follow
a linear history (no branching). Each migration has a descriptive slug and a timestamp prefix.

```
alembic/versions/
  2024_01_15_001_create_workspaces_table.py
  2024_01_15_002_create_users_table.py
  2024_01_16_001_create_projects_table.py
  2024_01_16_002_create_tasks_table.py
  2024_02_03_001_add_story_points_to_tasks.py
  2024_03_11_001_add_time_tracking_entries.py
```

Migrations are applied automatically during container startup via an init container in the ECS task
definition. The init container runs `alembic upgrade head` and exits before the application container
starts. This ensures the database schema is always consistent with the deployed code version.

Backward-incompatible migrations (column renames, type changes) follow an expand-and-contract
pattern: a first deploy adds the new column, a second deploy backfills data and updates application
code, and a third deploy drops the old column.

#### Query Patterns

All database access goes through repository classes that use SQLAlchemy 2.0 async sessions with
the `asyncpg` driver. Queries are written using SQLAlchemy's expression language rather than raw
SQL strings to benefit from composability and type checking.

```python
# app/repositories/task_repository.py
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

class TaskRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def find_by_project(
        self, project_id: int, status: str | None, limit: int, offset: int
    ) -> tuple[list[Task], int]:
        query = select(Task).where(Task.project_id == project_id)
        if status:
            query = query.where(Task.status == status)
        query = query.order_by(Task.position).limit(limit).offset(offset)

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar_one()
        results = (await self.session.execute(query)).scalars().all()
        return results, total
```

Read-heavy endpoints use read replicas via a separate SQLAlchemy engine bound to the replica
endpoint. The repository base class accepts a `use_replica: bool` parameter that selects the
appropriate session. Write-after-read consistency is maintained by routing all requests within
a mutation endpoint to the primary.

### Authentication & Authorization

#### JWT Flow

Authentication uses short-lived JWTs (15-minute expiry) paired with longer-lived refresh tokens
(7-day expiry, rotated on each use). The login endpoint validates credentials against bcrypt-hashed
passwords and returns both tokens. The access token is stored in memory on the client; the refresh
token is stored in an HttpOnly secure cookie.

```python
# Token payload structure
{
    "sub": "user:4821",           # Subject: user ID
    "wid": 12,                    # Workspace ID
    "role": "member",             # Workspace-level role
    "exp": 1710000000,            # Expiration timestamp
    "iat": 1709999100,            # Issued-at timestamp
    "jti": "a1b2c3d4-e5f6-..."   # Unique token ID for revocation
}
```

Token signing uses RS256 with a 2048-bit RSA key pair. The public key is exposed at
`/.well-known/jwks.json` for potential future use by internal services. Refresh token rotation
is implemented with a token family concept: if a previously rotated refresh token is reused,
the entire family is invalidated to mitigate token theft.

#### Role-Based Access Control

Authorization follows a two-level model: workspace roles and project roles. Workspace roles
(`owner`, `admin`, `member`, `guest`) control access to workspace-wide settings, billing, and
member management. Project roles (`manager`, `contributor`, `viewer`) control task manipulation
within a specific project.

Permissions are evaluated by a `PermissionChecker` dependency that is injected into endpoints
requiring authorization beyond basic authentication:

```python
@router.delete("/{task_id}")
async def delete_task(
    task_id: int,
    _=Depends(require_permission("tasks:delete")),
    task_service: TaskService = Depends(),
):
    await task_service.delete(task_id)
```

The `require_permission` function returns a dependency that resolves the user's effective permissions
by combining their workspace role, project role, and any explicit permission overrides. Permission
definitions are stored in a YAML configuration file rather than in the database, keeping the
authorization model version-controlled and auditable.

### Background Jobs

#### Task Queue (Celery)

Background job processing uses Celery 5 with Redis as the message broker. Celery workers run in
dedicated ECS tasks with autoscaling based on queue depth (CloudWatch metric published by a
sidecar process). Workers use the `prefork` pool with 4 worker processes per container.

```python
# app/workers/tasks.py
from app.worker import celery_app

@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_task_assignment_notification(self, task_id: int, assignee_id: int):
    """Send email and in-app notification when a task is assigned."""
    try:
        task = TaskRepository.get_by_id(task_id)
        user = UserRepository.get_by_id(assignee_id)
        EmailService.send_template("task_assigned", user.email, context={"task": task})
        InAppNotificationService.create(user_id=assignee_id, event="task_assigned", payload={"task_id": task_id})
    except TransientError as exc:
        raise self.retry(exc=exc)
```

Job types include notification delivery (email and in-app), webhook dispatch for integrations,
report generation (CSV/PDF exports), and bulk operations (moving all tasks between sprints).
Each job type has its own Celery queue with independent concurrency settings to prevent
long-running exports from starving time-sensitive notifications.

#### Scheduled Tasks

Periodic tasks are defined using Celery Beat with a database-backed schedule stored in Redis.
The beat scheduler runs as a single instance (ensured by a Redis lock) alongside the worker fleet.

Key scheduled tasks:

| Task                        | Schedule     | Description                                        |
| --------------------------- | ------------ | -------------------------------------------------- |
| `cleanup_expired_tokens`    | Every 1 hour | Removes expired refresh tokens from Redis           |
| `send_daily_digest`         | 8:00 AM UTC  | Sends daily summary email to users with updates     |
| `recalculate_sprint_stats`  | Every 15 min | Updates burndown chart data for active sprints       |
| `sync_external_calendars`   | Every 30 min | Pulls updated availability from Google Calendar      |
| `archive_completed_sprints` | Daily 2 AM   | Moves sprints completed >30 days ago to archive     |

Each scheduled task is idempotent so that missed executions or double-firings do not cause
data corruption. The `recalculate_sprint_stats` task uses a Redis lock to prevent overlapping
runs when execution time exceeds the 15-minute interval.

---

## Infrastructure

### Docker Setup

The application uses a multi-stage Dockerfile to produce minimal production images. The build
stage installs dependencies and compiles Python bytecode; the runtime stage copies only the
necessary artifacts onto a slim Debian base image.

```dockerfile
# Build stage
FROM python:3.12-slim AS builder
WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN pip install poetry && poetry export -f requirements.txt -o requirements.txt
RUN pip install --prefix=/install -r requirements.txt

# Runtime stage
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /install /usr/local
COPY ./app ./app
COPY ./alembic ./alembic
COPY alembic.ini .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

Local development uses Docker Compose with services for the API, PostgreSQL, Redis, Celery
worker, and Celery Beat. Volumes are mounted for live code reloading via Uvicorn's `--reload`
flag. The frontend runs outside Docker on the host using Vite's dev server to preserve
fast HMR performance.

### CI/CD Pipeline

The CI/CD pipeline runs on GitHub Actions with the following stages:

1. **Lint and Type Check** -- Runs `ruff check`, `mypy`, and `eslint` / `tsc --noEmit` in parallel.
2. **Unit Tests** -- Runs `pytest` with a PostgreSQL service container. Coverage must meet an 80% threshold.
3. **Integration Tests** -- Spins up the full Docker Compose stack and runs API-level tests with `httpx`.
4. **Build and Push** -- Builds the Docker image, tags it with the Git SHA, and pushes to Amazon ECR.
5. **Deploy to Staging** -- Updates the ECS service with the new task definition (staging cluster).
6. **Smoke Tests** -- Runs a small suite of end-to-end checks against the staging URL.
7. **Deploy to Production** -- Requires manual approval via a GitHub environment protection rule.

The pipeline caches Poetry dependencies and Docker layers between runs. Typical pipeline duration
is 6-8 minutes for stages 1-5. Production deploys use ECS rolling updates with a minimum healthy
percent of 100% to avoid downtime.

### Monitoring & Logging

Observability is built on three pillars:

**Metrics** are collected by a Prometheus sidecar in each ECS task and scraped by a central
Prometheus server running on a dedicated EC2 instance. Key application metrics include request
latency histograms, active database connections, Celery queue depths, and task processing
durations. Grafana dashboards visualize these metrics with alerts configured for p99 latency
spikes and error rate increases.

**Logs** are emitted as structured JSON to stdout and collected by the ECS log driver into
CloudWatch Logs. Each log entry includes a correlation ID (propagated from the `X-Request-ID`
header) to enable request tracing across the API and Celery workers. Log retention is set to
30 days in staging and 90 days in production.

**Traces** use OpenTelemetry with the OTLP exporter sending spans to a Tempo backend. FastAPI
middleware automatically creates spans for each request, and SQLAlchemy events add child spans
for database queries. This allows identifying slow queries directly from a request trace in
Grafana.

### Deployment

#### Staging Environment

The staging environment mirrors production in architecture but runs on smaller instance sizes
(t3.medium for ECS, db.t3.medium for RDS). It uses a separate AWS account to enforce IAM
boundary isolation. The staging database is seeded nightly from a sanitized snapshot of
production data (PII fields are replaced with synthetic values using a custom Alembic data
command).

Staging deploys happen automatically on every merge to the `main` branch. The staging URL is
accessible only through the company VPN. Feature branches can be deployed to staging manually
by triggering the `deploy-preview` workflow with the branch name as input.

#### Production Environment

Production runs on AWS ECS Fargate in the `us-east-1` region with the following resource
allocation:

| Component       | Instance Type / Size | Count | Autoscaling               |
| --------------- | -------------------- | ----- | ------------------------- |
| API containers  | 1 vCPU / 2 GB       | 2-8   | Target tracking: CPU 60%  |
| Celery workers  | 1 vCPU / 2 GB       | 2-6   | Queue depth threshold     |
| Celery Beat     | 0.5 vCPU / 1 GB     | 1     | None (singleton)          |
| PostgreSQL (RDS)| db.r6g.xlarge        | 1+1   | Multi-AZ standby          |
| Redis           | cache.r6g.large      | 1     | None                      |

Deployments use ECS rolling updates with health check grace periods of 60 seconds. The deployment
process performs a database migration (via init container), waits for the new task set to reach
steady state, and then drains connections from the old task set over 30 seconds. Rollbacks are
triggered automatically if the new task set fails to stabilize within 5 minutes, reverting to
the previous task definition revision.

Database backups are taken by RDS automated snapshots every 12 hours with a 14-day retention
period. Point-in-time recovery is enabled. A weekly backup is copied to a separate AWS account
for disaster recovery purposes.
