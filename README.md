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

Implemented in [backup/](backup/) and run as the `backup` service in [docker-stack.yml](docker-stack.yml).

- **Schedule:** daily at 03:00 UTC (override with `BACKUP_CRON`). Each run does `pg_dump -Fc`, checks the archive with `pg_restore --list`, and uploads it to the `ece1779-task-db-backups` DigitalOcean Spaces bucket under `backups/`.
- **Retention:** backups older than 14 days are deleted (`BACKUP_RETENTION_DAYS`).
- **Credentials:** the database password and Spaces key/secret are Docker secrets. They are never committed (`secrets/` is git-ignored).
- **Restore:** `restore.sh [backup-file]` restores the latest or a named backup. It drops and recreates existing objects. To rehearse safely, restore into a scratch database (set `PGDATABASE=restore_test`) instead of the live one.
- **Status:** a backup and a restore into a scratch database have been tested on the manager. The first scheduled run and a real retention deletion have not yet been observed.

One-off backup or restore on the manager (the `backup` image is built locally there):

```
docker run --rm --network taskapp-db_backend -v /root/taskapp/secrets:/run/secrets:ro \
  -e PGHOST=db -e PGUSER=taskapp -e PGDATABASE=taskapp -e PGPASSWORD_FILE=/run/secrets/db_password.txt \
  -e SPACES_KEY_FILE=/run/secrets/spaces_key.txt -e SPACES_SECRET_FILE=/run/secrets/spaces_secret.txt \
  -e SPACES_BUCKET=ece1779-task-db-backups -e SPACES_ENDPOINT=https://tor1.digitaloceanspaces.com \
  taskapp-backup:latest now                      # add: --entrypoint restore.sh   to restore
```

## Deployment (DigitalOcean, Docker Swarm)

Two Droplets form the swarm: `ece1779-swarm-manager` (159.89.114.78) and `ece1779-swarm-worker` (138.197.156.189).

The database stack is [docker-stack.yml](docker-stack.yml), deployed as `taskapp-db`:

- **`db`:** PostgreSQL 16, one replica, pinned to the manager (`node.role == manager`) because the Block Storage Volume is attached only there. Data is bind-mounted from `/mnt/volume_tor1_1794236977286/postgres-data`. The volume is mounted through `/etc/fstab` (UUID, `nofail`) so it survives reboots. The schema is loaded from a Swarm config on first start only.
- **`backup`:** see Backups above.
- **Network:** both services use the `taskapp-db_backend` overlay network. No ports are published, so Postgres is reachable only from services on that network. API services should join it (it is `attachable`).
- **Restart policy:** `condition: any`. Postgres exits 0 on a clean shutdown, which `on-failure` would not restart.

Deploy or update from the manager, in `/root/taskapp` (contains `docker-stack.yml`, `db/init/`, `backup/` and `secrets/`):

```
docker build -t taskapp-backup:latest ./backup       # only when backup/ changes
docker stack deploy -c docker-stack.yml taskapp-db
```

Required files in `secrets/` on the manager: `db_password.txt`, `spaces_key.txt`, `spaces_secret.txt`. Docker secrets are immutable: to rotate one, remove the stack, update the file, and redeploy.

Verified: data survives removing and redeploying the service and rebooting the manager, and the database restarts on its own.
