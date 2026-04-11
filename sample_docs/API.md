# TaskFlow API Documentation

The TaskFlow API provides programmatic access to the TaskFlow project management platform.
All endpoints follow RESTful conventions and return JSON responses.

## Base URL & Versioning

All API requests should be made to the following base URL:

```
https://api.taskflow.io/api/v1
```

The API is versioned via the URL path. The current stable version is `v1`. When breaking changes are introduced, a new version will be released, and the previous version will remain available for at least 12 months after deprecation.

## Authentication

TaskFlow uses OAuth 2.0 Bearer tokens for API authentication. All requests to protected endpoints must include a valid access token in the `Authorization` header.

### Getting a Token

Send a `POST` request to the token endpoint with your client credentials. You can generate credentials from the dashboard under **Settings > API Keys**.

```bash
curl -X POST https://api.taskflow.io/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"client_id": "tf_client_8a3b2c1d4e5f", "client_secret": "tf_secret_9k8j7h6g5f4d", "grant_type": "client_credentials"}'
```

```json
{"access_token": "eyJhbGciOiJSUzI1NiIs...", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "tf_refresh_m4n5b6v7c8x9z0"}
```

### Using the Token

Include the access token in the `Authorization` header of every API request. Requests without a valid token receive a `401 Unauthorized` response.

```bash
curl -X GET https://api.taskflow.io/api/v1/users \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."
```

### Token Refresh

Access tokens expire after 1 hour. Use the refresh token to obtain a new access token without re-authenticating. Refresh tokens are valid for 30 days and are single-use.

```bash
curl -X POST https://api.taskflow.io/api/v1/auth/token/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "tf_refresh_m4n5b6v7c8x9z0", "grant_type": "refresh_token"}'
```

```json
{"access_token": "eyJhbGciOiJSUzI1NiIs.new...", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "tf_refresh_q1w2e3r4t5"}
```

## Endpoints

All endpoints require authentication unless otherwise noted. Request and response bodies use JSON. Timestamps follow ISO 8601 format in UTC.

### Users

Manage user accounts within your TaskFlow organization.

#### GET /api/v1/users

Returns a paginated list of all users. Supports filtering by `role` and `status` query parameters.

```bash
curl -X GET "https://api.taskflow.io/api/v1/users?role=member&status=active&page=1&per_page=20" \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "data": [
    {"id": "user_a1b2c3d4", "email": "alice@example.com", "full_name": "Alice Chen", "role": "member", "status": "active", "created_at": "2025-08-14T09:30:00Z"}
  ],
  "pagination": {"page": 1, "per_page": 20, "total_items": 47, "total_pages": 3}
}
```

#### GET /api/v1/users/:id

Returns detailed information for a single user including assigned projects and activity summary.

```bash
curl -X GET https://api.taskflow.io/api/v1/users/user_a1b2c3d4 \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "id": "user_a1b2c3d4", "email": "alice@example.com", "full_name": "Alice Chen",
  "role": "member", "status": "active", "projects_count": 5, "open_tasks_count": 12,
  "created_at": "2025-08-14T09:30:00Z", "last_active_at": "2026-04-10T17:45:22Z"
}
```

#### POST /api/v1/users

Creates a new user in the organization. An invitation email is sent automatically. Requires `admin` or `owner` role.

```bash
curl -X POST https://api.taskflow.io/api/v1/users \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "bob@example.com", "full_name": "Bob Martinez", "role": "member"}'
```

**Response (201 Created):**
```json
{"id": "user_e5f6g7h8", "email": "bob@example.com", "full_name": "Bob Martinez", "role": "member", "status": "invited", "created_at": "2026-04-11T10:15:00Z"}
```

#### PUT /api/v1/users/:id

Updates an existing user's profile. Admins can update any user; members can only update their own. The `role` field can only be changed by an owner.

```bash
curl -X PUT https://api.taskflow.io/api/v1/users/user_e5f6g7h8 \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"full_name": "Robert Martinez", "role": "admin"}'
```

**Response (200 OK):**
```json
{"id": "user_e5f6g7h8", "email": "bob@example.com", "full_name": "Robert Martinez", "role": "admin", "status": "active", "updated_at": "2026-04-11T11:00:00Z"}
```

#### DELETE /api/v1/users/:id

Deactivates a user account. Data is retained for 90 days before permanent deletion. Open tasks are unassigned. Only owners can delete users.

```bash
curl -X DELETE https://api.taskflow.io/api/v1/users/user_e5f6g7h8 \
  -H "Authorization: Bearer <access_token>"
```

**Response:** `204 No Content` -- no response body is returned.

### Projects

Manage projects and their associated metadata within your organization.

#### GET /api/v1/projects

Returns a paginated list of projects. Supports filtering by `status` (`active`, `archived`, `completed`) and sorting by `created_at`, `updated_at`, or `name`.

```bash
curl -X GET "https://api.taskflow.io/api/v1/projects?status=active&sort_by=updated_at&order=desc" \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "data": [
    {"id": "proj_x1y2z3", "name": "Website Redesign", "description": "Overhaul of the marketing website.", "status": "active", "owner_id": "user_a1b2c3d4", "members_count": 8, "open_tasks_count": 23, "updated_at": "2026-04-10T14:30:00Z"}
  ],
  "pagination": {"page": 1, "per_page": 20, "total_items": 12, "total_pages": 1}
}
```

#### POST /api/v1/projects

Creates a new project. The authenticated user becomes the project owner. Optionally provide `member_ids` to add initial team members.

```bash
curl -X POST https://api.taskflow.io/api/v1/projects \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Mobile App v2", "description": "Native mobile rebuild using React Native.", "member_ids": ["user_a1b2c3d4", "user_e5f6g7h8"], "due_date": "2026-09-30T00:00:00Z"}'
```

**Response (201 Created):**
```json
{"id": "proj_k4l5m6", "name": "Mobile App v2", "description": "Native mobile rebuild using React Native.", "status": "active", "owner_id": "user_a1b2c3d4", "members_count": 3, "due_date": "2026-09-30T00:00:00Z", "created_at": "2026-04-11T10:30:00Z"}
```

#### PUT /api/v1/projects/:id

Updates a project's details. Only the project owner or an organization admin can modify project settings.

```bash
curl -X PUT https://api.taskflow.io/api/v1/projects/proj_x1y2z3 \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Website Redesign 2026", "status": "archived"}'
```

**Response (200 OK):**
```json
{"id": "proj_x1y2z3", "name": "Website Redesign 2026", "status": "archived", "updated_at": "2026-04-11T12:00:00Z"}
```

#### GET /api/v1/projects/:id/tasks

Returns all tasks belonging to a specific project. Supports filtering by `status`, `priority`, and `assignee_id`.

```bash
curl -X GET "https://api.taskflow.io/api/v1/projects/proj_x1y2z3/tasks?status=in_progress&priority=high" \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "data": [
    {"id": "task_p7q8r9", "title": "Implement responsive navigation", "status": "in_progress", "priority": "high", "assignee_id": "user_a1b2c3d4", "project_id": "proj_x1y2z3", "due_date": "2026-04-18T00:00:00Z"}
  ],
  "pagination": {"page": 1, "per_page": 20, "total_items": 5, "total_pages": 1}
}
```

### Tasks

Create, update, and manage individual tasks across all projects.

#### GET /api/v1/tasks

Returns a paginated list of tasks across all accessible projects. Supports filtering by `project_id`, `status`, `priority`, `assignee_id`, and `due_before`/`due_after` date ranges.

```bash
curl -X GET "https://api.taskflow.io/api/v1/tasks?assignee_id=user_a1b2c3d4&status=todo&due_before=2026-04-30T00:00:00Z" \
  -H "Authorization: Bearer <access_token>"
```

```json
{
  "data": [
    {"id": "task_s1t2u3", "title": "Write unit tests for auth module", "description": "Cover login, logout, token refresh, and password reset.", "status": "todo", "priority": "medium", "assignee_id": "user_a1b2c3d4", "project_id": "proj_k4l5m6", "tags": ["backend", "testing"], "due_date": "2026-04-20T00:00:00Z"}
  ],
  "pagination": {"page": 1, "per_page": 20, "total_items": 8, "total_pages": 1}
}
```

#### POST /api/v1/tasks

Creates a new task within a project. The `project_id` field is required. Valid priorities: `low`, `medium`, `high`, `critical`. Valid initial statuses: `todo`, `in_progress`.

```bash
curl -X POST https://api.taskflow.io/api/v1/tasks \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Design onboarding flow mockups", "description": "Create Figma mockups for new user onboarding with 3 A/B variants.", "project_id": "proj_k4l5m6", "assignee_id": "user_a1b2c3d4", "priority": "high", "tags": ["design", "onboarding"], "due_date": "2026-04-25T00:00:00Z"}'
```

**Response (201 Created):**
```json
{"id": "task_v4w5x6", "title": "Design onboarding flow mockups", "status": "todo", "priority": "high", "assignee_id": "user_a1b2c3d4", "project_id": "proj_k4l5m6", "tags": ["design", "onboarding"], "due_date": "2026-04-25T00:00:00Z", "created_at": "2026-04-11T13:00:00Z"}
```

#### PUT /api/v1/tasks/:id

Performs a full update on a task. All mutable fields can be changed. Set `assignee_id` to `null` to unassign.

```bash
curl -X PUT https://api.taskflow.io/api/v1/tasks/task_v4w5x6 \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Design onboarding flow mockups (revised)", "priority": "critical", "assignee_id": "user_e5f6g7h8", "due_date": "2026-04-22T00:00:00Z"}'
```

**Response (200 OK):**
```json
{"id": "task_v4w5x6", "title": "Design onboarding flow mockups (revised)", "priority": "critical", "assignee_id": "user_e5f6g7h8", "project_id": "proj_k4l5m6", "due_date": "2026-04-22T00:00:00Z", "updated_at": "2026-04-11T14:30:00Z"}
```

#### PATCH /api/v1/tasks/:id/status

Updates only the status of a task. Preferred for Kanban-style workflows. Valid statuses: `todo`, `in_progress`, `in_review`, `done`, `cancelled`. Invalid transitions return `422`.

```bash
curl -X PATCH https://api.taskflow.io/api/v1/tasks/task_v4w5x6/status \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review"}'
```

**Response (200 OK):**
```json
{"id": "task_v4w5x6", "status": "in_review", "previous_status": "in_progress", "updated_at": "2026-04-11T15:00:00Z"}
```

## Error Handling

The API uses conventional HTTP status codes. `2xx` indicates success, `4xx` indicates client errors, and `5xx` indicates server issues.

### Error Response Format

All error responses follow a consistent structure with a machine-readable `code`, human-readable `message`, and optional `details` array for validation errors.

```json
{
  "error": {
    "code": "validation_error",
    "message": "One or more fields failed validation.",
    "details": [
      {"field": "email", "message": "A valid email address is required."},
      {"field": "role", "message": "Role must be one of: member, admin, owner."}
    ]
  }
}
```

### Common Error Codes

| HTTP Status | Error Code              | Description                                              |
|-------------|-------------------------|----------------------------------------------------------|
| 400         | `bad_request`           | The request body is malformed or missing required fields. |
| 401         | `unauthorized`          | Authentication token is missing, expired, or invalid.    |
| 403         | `forbidden`             | The authenticated user lacks permission for this action. |
| 404         | `not_found`             | The requested resource does not exist.                   |
| 409         | `conflict`              | A resource with the same unique field already exists.    |
| 422         | `validation_error`      | One or more request fields failed validation.            |
| 429         | `rate_limit_exceeded`   | Too many requests; retry after the indicated wait time.  |
| 500         | `internal_server_error` | An unexpected server error occurred.                     |

## Rate Limiting

Requests are rate-limited to 1000/min (standard) or 5000/min (enterprise). Rate limit info is included in every response via headers:

| Header                  | Description                                          |
|-------------------------|------------------------------------------------------|
| `X-RateLimit-Limit`     | Maximum requests allowed per window.                 |
| `X-RateLimit-Remaining` | Requests remaining in the current window.            |
| `X-RateLimit-Reset`     | Unix timestamp when the window resets.               |

When exceeded, the API returns `429 Too Many Requests`:

```json
{"error": {"code": "rate_limit_exceeded", "message": "Rate limit exceeded. Retry after 12 seconds.", "retry_after": 12}}
```

## Pagination

All list endpoints return paginated results. Use `page` and `per_page` query parameters (default: 20, max: 100). Every response includes a `pagination` object.

```bash
curl -X GET "https://api.taskflow.io/api/v1/tasks?page=2&per_page=50" \
  -H "Authorization: Bearer <access_token>"
```

```json
{"pagination": {"page": 2, "per_page": 50, "total_items": 237, "total_pages": 5}}
```

For large datasets, cursor-based pagination is also supported. Pass `cursor` instead of `page`; the cursor value is returned in the `next_cursor` field.

## Webhooks

TaskFlow supports webhooks for real-time event notifications. Configure them via **Settings > Webhooks** or the API. Payloads are signed with HMAC-SHA256.

```bash
curl -X POST https://api.taskflow.io/api/v1/webhooks \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.example.com/webhooks/taskflow", "events": ["task.created", "task.updated", "task.status_changed", "project.archived"], "secret": "whsec_your_signing_secret"}'
```

Webhook payload example (delivered via `POST` with `X-TaskFlow-Signature` header):

```json
{
  "event": "task.status_changed",
  "timestamp": "2026-04-11T15:00:00Z",
  "data": {"task_id": "task_v4w5x6", "project_id": "proj_k4l5m6", "previous_status": "in_progress", "new_status": "in_review", "changed_by": "user_a1b2c3d4"}
}
```

Supported events: `task.created`, `task.updated`, `task.status_changed`, `task.deleted`, `project.created`, `project.updated`, `project.archived`, `user.invited`, `user.deactivated`. Failed deliveries are retried up to 5 times with exponential backoff over 24 hours.
