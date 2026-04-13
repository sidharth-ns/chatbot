# Contributing Guide

Thank you for your interest in contributing to TaskFlow! Please read this guide
before submitting your first contribution. For questions, open a discussion on
GitHub or reach out in the `#taskflow-dev` Slack channel.

## Getting Started

Make sure you have Python 3.11+, Node.js 20 LTS, PostgreSQL 15, and Docker
installed. You will also need a GitHub account with commit signing configured.

### Fork & Clone

Fork the `taskflow-platform/taskflow` repository, then clone your fork and add
the upstream remote:

```bash
git clone git@github.com:<your-username>/taskflow.git
cd taskflow
git remote add upstream git@github.com:taskflow-platform/taskflow.git
cp .env.example .env
cd backend && pip install -e ".[dev]" && cd ..
cd frontend && npm ci && cd ..
```

### Branch Strategy

We maintain two long-lived branches. `main` reflects the latest stable release
and is protected with required status checks. `develop` is the integration branch
where feature branches are merged after review. Never push directly to `main` or
`develop`; all changes go through pull requests.

## Development Workflow

All new work follows a branch-based workflow. Each unit of work lives on its own
short-lived branch, gets reviewed, and is merged into `develop`.

### Creating a Feature Branch

Create your branch from the latest `develop` HEAD with a descriptive name that
includes the issue number:

```bash
git checkout develop
git pull upstream develop
git checkout -b feat/1234-add-gantt-chart
```

Branch prefixes: `feat/` for features, `fix/` for bug fixes, `docs/` for
documentation, `refactor/` for restructuring, `chore/` for tooling updates.

### Making Changes

Keep changes focused on a single concern. Run the development servers to verify
your work locally before pushing:

```bash
cd backend && uvicorn taskflow.main:app --reload --port 8000
cd frontend && npm run dev
```

### Writing Tests

Every pull request must include tests covering new or changed behavior. We target
90% line coverage on new code. Backend tests use `pytest`; frontend tests use
`vitest` with React Testing Library.

```bash
cd backend && pytest --cov=taskflow --cov-report=term-missing
cd frontend && npm test
```

### Committing

We use conventional commits enforced by a Git hook. Squash trivial fixup commits
before requesting review.

#### Commit Message Format

Each commit has a type, optional scope, and subject. A body and footer are
optional but encouraged for non-trivial changes.

```
<type>(<scope>): <subject>

[optional body]
[optional footer(s)]
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`. The scope references the affected module
(`api`, `ui`, `db`, `auth`).

#### Pre-commit Hooks

Install the hooks after cloning the repository:

```bash
pre-commit install
pre-commit install --hook-type commit-msg
```

The hooks run `ruff check` and `ruff format` on Python files, `eslint` and
`prettier` on TypeScript files, and `commitlint` to validate the message format.
Do not use `--no-verify` to bypass hooks.

## Code Review Process

Every change must be reviewed and approved by at least one team member before
merging. Reviews focus on correctness, readability, test coverage, and adherence
to project conventions.

### Opening a Pull Request

Push your branch and open a pull request against `develop`. Fill out the PR
template completely and link the related GitHub issue.

```bash
git push origin feat/1234-add-gantt-chart
gh pr create --base develop --title "feat(ui): add Gantt chart component"
```

#### PR Template

The PR template includes the following required sections:

- **Summary**: What the PR does and why.
- **Related Issue**: Link to the GitHub issue (e.g., `Closes #1234`).
- **Type of Change**: Feature, bugfix, refactor, or documentation.
- **Screenshots**: Required for UI changes with before/after comparisons.
- **Testing Notes**: How reviewers can verify the change locally.

#### PR Checklist

Before marking your PR as ready for review:

- [ ] All CI checks pass (lint, type-check, unit tests, integration tests).
- [ ] Database migrations are backwards-compatible with a rollback path.
- [ ] No secrets or credentials are committed in the diff.
- [ ] Changelog entry added under the `Unreleased` section.
- [ ] Documentation updated if public APIs or config are affected.

### Review Guidelines

Reviewers should respond within one business day. Use comment labels to signal
intent: `nit:` for style preferences, `question:` for clarifications,
`suggestion:` for improvements, and `blocker:` for merge-blocking issues.
Pay close attention to error handling, SQL performance, and accessibility.

### Merging

Once approved with passing CI, the author merges using **Squash and Merge** to
keep the history linear. Delete the feature branch after merging.

```bash
git checkout develop && git pull upstream develop
git branch -d feat/1234-add-gantt-chart
```

## Coding Standards

Consistent style reduces cognitive load during reviews and makes the codebase
easier to navigate. The rules below are enforced by automated tooling.

### Python Style Guide

We follow PEP 8 with rules enforced by `ruff`. Max line length is 99 characters.
Use type hints on all function signatures. Prefer `pathlib.Path` over `os.path`.
FastAPI endpoints must use dependency injection for sessions and auth.

```python
@router.get("/{project_id}")
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProjectResponse:
    ...
```

### JavaScript Style Guide

Frontend code is TypeScript with strict mode. Use functional components with
hooks exclusively. Props interfaces must be explicitly defined and exported.
Use named exports instead of default exports.

```typescript
export interface GanttChartProps {
  projectId: string;
  startDate: Date;
  endDate: Date;
}

export function GanttChart({ projectId, startDate, endDate }: GanttChartProps) {
  const { data, isLoading } = useProjectTasks(projectId);
}
```

### SQL Conventions

Migrations are managed with Alembic. Table names use `snake_case` and are always
plural. Foreign keys follow `<referenced_table_singular>_id`. Every table must
include `created_at` and `updated_at` timestamp columns with server defaults.
Application code must use SQLAlchemy ORM queries; raw SQL is only for migrations.

## Release Process

TaskFlow follows a structured release process. Releases are cut from `develop`
after a stabilization period and merged into `main` with a version tag.

### Versioning

We use Semantic Versioning: `MAJOR.MINOR.PATCH`. MAJOR for breaking API changes,
MINOR for backwards-compatible features, PATCH for bug fixes. Pre-release versions
use suffixes like `2.4.0-rc.1`. Version is tracked in `backend/pyproject.toml`
and `frontend/package.json`.

### Changelog

We maintain `CHANGELOG.md` following the Keep a Changelog format. Every PR adds
an entry under `## [Unreleased]` in the appropriate category: Added, Changed,
Deprecated, Removed, Fixed, or Security. During release, the unreleased section
is renamed to the new version with the release date.

### Deployment Checklist

Before tagging a release, the release manager must:

1. Create a release branch named `release/vX.Y.Z` from `develop`.
2. Run the full test suite including integration and end-to-end tests.
3. Update version numbers in `pyproject.toml` and `package.json`.
4. Move changelog entries from `Unreleased` to the new version heading.
5. Open a PR from the release branch into `main` and get two approvals.
6. Tag the merge commit on `main` with `vX.Y.Z` and push the tag.
7. Verify CI/CD deploys to staging, run smoke tests, then promote to production.
8. Merge `main` back into `develop` to incorporate the version bump.
