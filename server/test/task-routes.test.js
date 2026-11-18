const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  member,
  request,
  assertTaskShape,
  testEndpointAccess,
  invalidTaskFields,
  overflowId,
} = require("./route-test-support");

const taskUrl = "/api/tasks/1";
const collectionUrl = "/api/projects/1/tasks";

testEndpointAccess([
  { method: "GET", url: "/api/tasks/:id", id: "1", resource: "Task" },
  {
    method: "PATCH",
    url: "/api/tasks/:id",
    id: "1",
    resource: "Task",
    body: { title: "Changed" },
  },
  { method: "DELETE", url: "/api/tasks/:id", id: "1", resource: "Task" },
]);

test("GET task returns the task to a member without internal authorization fields", async () => {
  const task = await request("GET", taskUrl, 200, { user: member });
  assertTaskShape(task);
  assert.equal(task.id, "1");
  assert.equal(task.title, "Primary task");
});

test("PATCH task lets a member change only the supplied fields", async () => {
  const before = await request("GET", taskUrl, 200);
  const updated = await request("PATCH", taskUrl, 200, {
    user: member,
    body: { status: "in_progress", assignee_id: null },
  });
  assertTaskShape(updated);
  assert.deepEqual(updated, {
    ...before,
    status: "in_progress",
    assignee_id: null,
    updated_at: updated.updated_at,
  });
  assert.deepEqual(await request("GET", taskUrl, 200), updated);
});

test("DELETE task requires an admin and removes the task from its project", async () => {
  const task = await request("GET", taskUrl, 200);
  assert.deepEqual(await request("DELETE", taskUrl, 403, { user: member }), {
    error: "Admin permission required",
  });
  assert.deepEqual(await request("GET", taskUrl, 200), task);
  assert.deepEqual(await request("DELETE", taskUrl, 200), task);
  await request("GET", taskUrl, 404);
  assert.deepEqual(await request("GET", collectionUrl, 200), []);
});

test("PATCH task rejects invalid bodies without changing the task", async () => {
  const before = await request("GET", taskUrl, 200);
  for (const [body, error] of [
    [{}, "Empty request body"],
    ...invalidTaskFields,
  ]) {
    assert.deepEqual(await request("PATCH", taskUrl, 400, { body }), { error });
  }
  assert.deepEqual(await request("GET", taskUrl, 200), before);
});

test("PATCH rejects an assignee ID outside the BIGINT range", async () => {
  const body = { assignee_id: overflowId };
  assert.deepEqual(await request("PATCH", taskUrl, 400, { body }), {
    error: "Invalid assignee ID",
  });
});
