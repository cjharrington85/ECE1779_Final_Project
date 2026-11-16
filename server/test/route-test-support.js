const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { after, before, beforeEach, test } = require("node:test");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");

const databaseName = `ece1779_test_${randomUUID().replaceAll("-", "")}`;
const jwtSecret = randomUUID();
const admin = "1";
const member = "2";
const outsider = "3";
const missingId = "9223372036854775807";
const overflowId = "9223372036854775808";
let databaseAdmin;
let databaseCreated = false;
let pool;
let server;

before(async () => {
  const port = Number(process.env.TEST_DB_PORT);
  assert.ok(
    Number.isInteger(port) && port > 0 && port <= 65535,
    "Set TEST_DB_PORT to the port of a local PostgreSQL test instance",
  );

  const user = process.env.TEST_DB_USER || "postgres";
  const password = process.env.TEST_DB_PASSWORD || "";
  databaseAdmin = new Client({
    host: "127.0.0.1",
    port,
    user,
    password,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });
  await databaseAdmin.connect();
  // The identifier is generated locally and contains only letters, digits and underscores.
  await databaseAdmin.query(`CREATE DATABASE ${databaseName}`);
  databaseCreated = true;

  process.env.DB_HOST = "127.0.0.1";
  process.env.DB_PORT = String(port);
  process.env.DB_USER = user;
  process.env.DB_PASSWORD = password;
  process.env.DB_NAME = databaseName;
  process.env.JWT_SECRET = jwtSecret;
  pool = require("../src/db");
  const schema = await readFile(
    path.join(__dirname, "../../db/init/001_schema.sql"),
    "utf8",
  );
  await pool.query(schema);

  const app = require("../src/app");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
});

after(async () => {
  try {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool?.end();
    if (databaseCreated) {
      await databaseAdmin.query(`DROP DATABASE ${databaseName}`);
    }
  } finally {
    await databaseAdmin?.end();
  }
});

beforeEach(async () => {
  await pool.query(`
    TRUNCATE tasks, projects, team_members, teams, users RESTART IDENTITY;

    INSERT INTO users (email, username, password_hash) VALUES
      ('admin@example.test', 'admin', 'unused'),
      ('member@example.test', 'member', 'unused'),
      ('outsider@example.test', 'outsider', 'unused');

    INSERT INTO teams (name) VALUES ('Primary team'), ('Other team');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      (1, 1, 'admin'), (1, 2, 'member'), (2, 2, 'admin'), (2, 3, 'admin');

    INSERT INTO projects (team_id, name, description) VALUES
      (1, 'Primary project', 'Project description'),
      (1, 'Empty project', ''),
      (2, 'Other project', '');

    INSERT INTO tasks
      (project_id, title, description, priority, assignee_id, due_date, created_by)
    VALUES
      (1, 'Primary task', 'Task description', 'high', 2, '2030-06-15', 1),
      (3, 'Other task', 'Other description', 'medium', 3, NULL, 3);
  `);
});

async function request(method, url, expectedStatus, { user = admin, body, token } = {}) {
  const headers = {};
  if (user !== null || token !== undefined) {
    headers.Authorization = `Bearer ${token ?? jwt.sign({ id: user }, jwtSecret)}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    expectedStatus,
    `${method} ${url} returned ${response.status}; expected ${expectedStatus}. ${text.slice(0, 250)}`,
  );
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  return JSON.parse(text);
}

function assertProjectShape(project) {
  assert.deepEqual(Object.keys(project).sort(), [
    "created_at", "description", "id", "name", "team_id",
  ]);
}

function assertTaskShape(task) {
  assert.deepEqual(Object.keys(task).sort(), [
    "assignee_id", "created_at", "created_by", "description", "due_date", "id",
    "priority", "project_id", "search", "status", "title", "updated_at",
  ]);
}

function testEndpointAccess(endpoints) {
  for (const { method, url, id, resource, body } of endpoints) {
    const existingUrl = url.replace(":id", id);

    test(`${method} ${url} requires a valid JWT`, async () => {
      assert.deepEqual(await request(method, existingUrl, 401, { user: null, body }), {
        error: "Authentication required",
      });
      assert.deepEqual(await request(method, existingUrl, 401, { token: "invalid", body }), {
        error: "Invalid or expired token",
      });
    });

    test(`${method} ${url} rejects invalid IDs and reports missing resources`, async () => {
      for (const invalidId of ["abc", "0", "-1", overflowId]) {
        const response = await request(method, url.replace(":id", invalidId), 400, { body });
        assert.deepEqual(response, { error: `Invalid ${resource.toLowerCase()} ID` });
      }
      assert.deepEqual(await request(method, url.replace(":id", missingId), 404, { body }), {
        error: `${resource} not found`,
      });
    });

    test(`${method} ${url} denies an admin from a different team`, async () => {
      assert.deepEqual(await request(method, existingUrl, 403, { user: outsider, body }), {
        error: "Access denied",
      });
    });
  }
}

const invalidTaskFields = [
  [{ title: " " }, "Invalid title"],
  [{ description: null }, "Invalid description"],
  [{ priority: "immediate" }, "Invalid priority"],
  [{ status: "unknown" }, "Invalid status"],
  [{ assignee_id: "invalid" }, "Invalid assignee ID"],
  [{ assignee_id: outsider }, "Assignee is not a team member"],
  [{ due_date: "2030-02-30" }, "Invalid due date"],
  [{ project_id: "3" }, "Unknown task field"],
];

module.exports = {
  admin,
  member,
  outsider,
  request,
  assertProjectShape,
  assertTaskShape,
  testEndpointAccess,
  invalidTaskFields,
  overflowId,
};
