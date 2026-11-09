-- DEV ONLY sample data. Never mount this in production.
-- password_hash values are placeholders, not real hashes; real accounts must
-- be created through the auth API.

BEGIN;

INSERT INTO users (email, username, password_hash) VALUES
    ('orin@example.com',    'orin',    'placeholder-not-a-real-hash'),
    ('wentao@example.com',  'wentao',  'placeholder-not-a-real-hash'),
    ('cameron@example.com', 'cameron', 'placeholder-not-a-real-hash'),
    ('ishmam@example.com',  'ishmam',  'placeholder-not-a-real-hash');

INSERT INTO teams (name, created_by) VALUES
    ('ECE1779 Group', (SELECT id FROM users WHERE username = 'cameron'));

INSERT INTO team_members (team_id, user_id, role)
SELECT t.id, u.id,
       CASE WHEN u.username = 'cameron' THEN 'admin'::team_role ELSE 'member'::team_role END
FROM teams t CROSS JOIN users u
WHERE t.name = 'ECE1779 Group';

INSERT INTO projects (team_id, name, description)
SELECT id, 'Task Platform', 'Final project deliverables' FROM teams WHERE name = 'ECE1779 Group';

INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, created_by, due_date)
SELECT p.id, v.title, v.descr, v.status::task_status, v.priority::task_priority,
       (SELECT id FROM users WHERE username = v.assignee),
       (SELECT id FROM users WHERE username = 'cameron'),
       v.due::date
FROM projects p,
     (VALUES
        ('Design database schema',   'Tables, indexes, triggers',          'done',        'high',   'cameron', '2026-11-07'),
        ('User auth API',            'Register, login, JWT',               'in_progress', 'high',   'orin',    '2026-11-14'),
        ('Task CRUD API',            'Create, assign, update, search',     'in_progress', 'medium', 'wentao',  '2026-11-14'),
        ('Docker Swarm deployment',  'Two droplets, nginx, block volume',  'todo',        'urgent', 'ishmam',  '2026-11-21'),
        ('Automated pg_dump backup', 'Nightly dump to DigitalOcean Spaces','todo',        'medium', 'cameron', '2026-11-21')
     ) AS v(title, descr, status, priority, assignee, due)
WHERE p.name = 'Task Platform';

COMMIT;
