# ECE1779_Final_Project
Cameron Harding, Wentao Yang, Orin Chowdhury, Ishmam Ahmed

## Database

PostgreSQL schema: [db/init/001_schema.sql](db/init/001_schema.sql). It is loaded automatically the first time the `db` container starts with an empty data directory.

### Tables

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Accounts and credentials | `id`, `email`, `username`, `password_hash` (email and username are unique, case-insensitive) |
| `teams` | Groups of users | `id`, `name`, `created_by` |
| `team_members` | Links users to teams and defines access | `team_id`, `user_id`, `role` (`admin` or `member`); primary key is `(team_id, user_id)` |
| `projects` | Belong to one team | `id`, `team_id`, `name`, `description` |
| `tasks` | Work items within a project | `id`, `project_id`, `title`, `description`, `status`, `priority`, `assignee_id`, `created_by`, `due_date`, `created_at`, `updated_at`, `search` |

```
users --< team_members >-- teams --< projects --< tasks >-- users (assignee)
```

### Access control

Roles are per team, stored in `team_members.role`, not on the user. The same user can be an admin in one team and a member in another. The API must check membership before any read or write.

- `admin`: manage members, create and delete projects, full task write access.
- `member`: read everything in the team, create and update tasks.

### Enums

- `task_status`: `todo`, `in_progress`, `done`
- `task_priority`: `low`, `medium`, `high`, `urgent`
- `team_role`: `admin`, `member`

### Behavior to know about

- **Deletes:** deleting a team removes its members, projects, and tasks. Deleting a project removes its tasks. Deleting a user keeps their tasks and clears `assignee_id` and `created_by`.
- **Search:** `tasks.search` is a generated full-text column (title and description). Query it with `search @@ plainto_tsquery('english', 'keyword')`. Assignee and status filters are indexed.
- **`updated_at`:** set automatically by a trigger on every task update.
- **Real-time events:** every task insert, update, or delete sends a `NOTIFY` on the `task_events` channel with payload `{"op": "INSERT|UPDATE|DELETE", "task_id", "project_id", "team_id"}`. Each API replica should `LISTEN task_events` and forward events to its own WebSocket clients. The payload contains IDs only; fetch the task row if the full data is needed.

### Local development

```
echo devpassword > secrets/db_password.txt
docker compose up -d db
docker compose --profile seed run --rm seed   # optional sample data (dev only)
```

Schema changes only apply on a fresh data directory. To re-run the schema locally, run `docker compose down -v` first (this deletes local data).

### Backups

[backup/](backup/) contains `backup.sh` (`pg_dump` to DigitalOcean Spaces, 14-day retention) and `restore.sh` (restores the latest or a named backup; destructive). Not yet tested against a live database or Spaces.
