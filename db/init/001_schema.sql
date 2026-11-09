-- ECE1779 Final Project: PostgreSQL schema
-- Runs automatically on first container start when mounted at
-- /docker-entrypoint-initdb.d/ (only if the data directory is empty).

BEGIN;

-- ---------------------------------------------------------------- types
CREATE TYPE team_role     AS ENUM ('admin', 'member');
CREATE TYPE task_status   AS ENUM ('todo', 'in_progress', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- ---------------------------------------------------------------- users
-- Identity and credentials only. Permissions are per-team (see team_members).
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL,
    username      TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,  -- bcrypt/argon2 hash, never plaintext
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness
CREATE UNIQUE INDEX users_email_key    ON users (lower(email));
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

-- ---------------------------------------------------------------- teams
CREATE TABLE teams (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    created_by BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------- team_members
-- Access control: a user's role in a team determines what they may do.
--   admin  -> manage members, create/delete projects, full task write access
--   member -> read everything in the team, create/update tasks
CREATE TABLE team_members (
    team_id   BIGINT      NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role      team_role   NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

-- -------------------------------------------------------------- projects
CREATE TABLE projects (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id     BIGINT      NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_team_idx ON projects (team_id);

-- ----------------------------------------------------------------- tasks
CREATE TABLE tasks (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id  BIGINT        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    title       TEXT          NOT NULL CHECK (length(btrim(title)) > 0),
    description TEXT          NOT NULL DEFAULT '',
    status      task_status   NOT NULL DEFAULT 'todo',
    priority    task_priority NOT NULL DEFAULT 'medium',
    assignee_id BIGINT        REFERENCES users (id) ON DELETE SET NULL,
    created_by  BIGINT        REFERENCES users (id) ON DELETE SET NULL,
    due_date    DATE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- Full-text search over title + description (keyword search requirement)
    search      TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
    ) STORED
);
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);
CREATE INDEX tasks_assignee_idx       ON tasks (assignee_id);
CREATE INDEX tasks_search_idx         ON tasks USING GIN (search);

-- Keep updated_at fresh on every change
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------- real-time (LISTEN/NOTIFY)
-- Each API replica runs `LISTEN task_events` and forwards messages to the
-- WebSocket clients connected to it. The payload is kept small (NOTIFY is
-- limited to 8000 bytes): clients/replicas re-fetch the row by id if needed.
-- Payload: {"op":"INSERT|UPDATE|DELETE","task_id":1,"project_id":2,"team_id":3}
CREATE FUNCTION notify_task_event() RETURNS trigger AS $$
DECLARE
    rec     tasks;
    team_id BIGINT;
BEGIN
    rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    SELECT p.team_id INTO team_id FROM projects p WHERE p.id = rec.project_id;
    -- team_id is NULL when the project itself is being cascade-deleted; skip.
    IF team_id IS NOT NULL THEN
        PERFORM pg_notify('task_events', json_build_object(
            'op',         TG_OP,
            'task_id',    rec.id,
            'project_id', rec.project_id,
            'team_id',    team_id
        )::text);
    END IF;
    RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_notify
    AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION notify_task_event();

COMMIT;
