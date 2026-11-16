const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  admin,
  member,
  outsider,
  request,
  assertProjectShape,
  assertTaskShape,
  testEndpointAccess,
  invalidTaskFields,
  overflowId,
} = require("./route-test-support");

const taskUrl = "/api/tasks/1";
const projectUrl = "/api/projects/1";
const collectionUrl = `${projectUrl}/tasks`;

testEndpointAccess([
  { method: "GET", url: "/api/projects/:id/tasks", id: "1", resource: "Project" },
  { method: "POST", url: "/api/projects/:id/tasks", id: "1", resource: "Project", body: { title: "Created" } },
  { method: "GET", url: "/api/projects/:id", id: "1", resource: "Project" },
  { method: "PATCH", url: "/api/projects/:id", id: "1", resource: "Project", body: { name: "Changed" } },
  { method: "DELETE", url: "/api/projects/:id", id: "1", resource: "Project" },
]);

test("GET project tasks returns only tasks in that project and supports empty lists", async () => {
  const tasks = await request("GET", collectionUrl, 200, { user: member });
  assert.equal(tasks.length, 1);
  assertTaskShape(tasks[0]);
  assert.equal(tasks[0].id, "1");
  assert.equal(tasks[0].project_id, "1");
  assert.deepEqual(await request("GET", "/api/projects/2/tasks", 200, { user: member }), []);
});

test("POST project tasks lets a member create a task with defaults and persists it", async () => {
  const task = await request("POST", collectionUrl, 201, {
    user: member,
    body: { title: "Created by a member", assignee_id: admin },
  });
  assertTaskShape(task);
  assert.equal(task.project_id, "1");
  assert.equal(task.title, "Created by a member");
  assert.equal(task.created_by, member);
  assert.equal(task.assignee_id, admin);
  assert.equal(task.status, "todo");
  assert.equal(task.priority, "medium");
  assert.equal(task.description, "");
  assert.equal(task.due_date, null);
  assert.deepEqual(await request("GET", `/api/tasks/${task.id}`, 200), task);
});

test("GET project returns the same public fields to members and admins", async () => {
  const project = await request("GET", projectUrl, 200, { user: member });
  assertProjectShape(project);
  assert.equal(project.id, "1");
  assert.equal(project.name, "Primary project");
  assert.deepEqual(await request("GET", projectUrl, 200), project);
});

test("PATCH project requires an admin and preserves fields omitted from the request", async () => {
  const before = await request("GET", projectUrl, 200);
  const body = { name: "Team's renamed project" };
  assert.deepEqual(await request("PATCH", projectUrl, 403, { user: member, body }), {
    error: "Admin permission required",
  });
  assert.deepEqual(await request("GET", projectUrl, 200), before);
  const renamed = await request("PATCH", projectUrl, 200, { body });
  assertProjectShape(renamed);
  assert.deepEqual(renamed, { ...before, ...body });

  const cleared = await request("PATCH", projectUrl, 200, { body: { description: "" } });
  assert.deepEqual(cleared, { ...renamed, description: "" });
  assert.deepEqual(await request("GET", projectUrl, 200), cleared);
});

test("DELETE project requires an admin and removes the project and its tasks", async () => {
  const project = await request("GET", projectUrl, 200);
  assert.deepEqual(await request("DELETE", projectUrl, 403, { user: member }), {
    error: "Admin permission required",
  });
  assert.deepEqual(await request("GET", projectUrl, 200), project);
  await request("GET", taskUrl, 200);
  assert.deepEqual(await request("DELETE", projectUrl, 200), project);
  await request("GET", projectUrl, 404);
  await request("GET", collectionUrl, 404);
  await request("GET", taskUrl, 404);
  await request("GET", "/api/projects/3", 200, { user: outsider });
  await request("GET", "/api/tasks/2", 200, { user: outsider });
});

test("A member of one team may administer projects and tasks in another team", async () => {
  const updated = await request("PATCH", "/api/projects/3", 200, {
    user: member,
    body: { name: "Other team renamed" },
  });
  assert.equal(updated.name, "Other team renamed");
  await request("DELETE", "/api/tasks/2", 200, { user: member });
  await request("DELETE", "/api/projects/3", 200, { user: member });
});

test("POST project tasks rejects invalid bodies without creating a task", async () => {
  const before = await request("GET", collectionUrl, 200);
  assert.deepEqual(await request("POST", collectionUrl, 400, { body: {} }), {
    error: "Invalid title",
  });
  for (const [fields, error] of invalidTaskFields) {
    const body = { title: "Would be created", ...fields };
    assert.deepEqual(await request("POST", collectionUrl, 400, { body }), { error });
  }
  assert.deepEqual(await request("GET", collectionUrl, 200), before);
});

test("PATCH project rejects invalid bodies without changing the project", async () => {
  const before = await request("GET", projectUrl, 200);
  for (const [body, error] of [
    [undefined, "Expected a non-empty project object"],
    [{}, "Expected a non-empty project object"],
    [[], "Expected a non-empty project object"],
    [{ name: " " }, "Invalid name"],
    [{ name: 42 }, "Invalid name"],
    [{ description: null }, "Invalid description"],
    [{ description: "invalid\0text" }, "Invalid description"],
    [{ team_id: "2" }, "Unknown project field"],
  ]) {
    assert.deepEqual(await request("PATCH", projectUrl, 400, { body }), { error });
  }
  assert.deepEqual(await request("GET", projectUrl, 200), before);
});

test("POST rejects an assignee ID outside the BIGINT range", async () => {
  const body = { title: "Invalid assignee", assignee_id: overflowId };
  assert.deepEqual(await request("POST", collectionUrl, 400, { body }), {
    error: "Invalid assignee ID",
  });
});
