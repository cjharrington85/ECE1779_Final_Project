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
  missingId,
  queryRows,
  testEndpointAuthentication,
} = require("./route-test-support");

const taskUrl = "/api/tasks/1";
const projectUrl = "/api/projects/1";
const collectionUrl = `${projectUrl}/tasks`;

testEndpointAuthentication("POST", "/api/projects", {
  team_id: "1",
  name: "Created",
});

test("POST project creates and persists a project with optional description", async () => {
  for (const body of [
    { team_id: "1", name: "Team's new project", description: "Details'; --" },
    { team_id: 1, name: "Default description" },
    { team_id: "2", name: "Other team", description: "" },
  ]) {
    const project = await request("POST", "/api/projects", 201, {
      user: body.team_id === "2" ? member : admin,
      body,
    });
    assertProjectShape(project);
    assert.equal(typeof project.id, "string");
    assert.equal(project.team_id, String(body.team_id));
    assert.equal(project.name, body.name);
    assert.equal(project.description, body.description ?? "");
    assert.ok(Number.isFinite(Date.parse(project.created_at)));
    assert.deepEqual(
      await request("GET", `/api/projects/${project.id}`, 200, {
        user: member,
      }),
      project,
    );
  }
});

test("POST project rejects members and admins of other teams without inserting", async () => {
  const before = await queryRows("SELECT * FROM projects ORDER BY id");
  for (const user of [member, outsider]) {
    assert.deepEqual(
      await request("POST", "/api/projects", 403, {
        user,
        body: { team_id: "1", name: "Forbidden" },
      }),
      { error: "Admin permission required" },
    );
  }
  assert.deepEqual(
    await queryRows("SELECT * FROM projects ORDER BY id"),
    before,
  );
});

test("POST project reports nonexistent teams", async () => {
  assert.deepEqual(
    await request("POST", "/api/projects", 404, {
      body: { team_id: missingId, name: "Missing team" },
    }),
    { error: "Team not found" },
  );
});

test("POST project validates bodies without inserting", async () => {
  const before = await queryRows("SELECT * FROM projects ORDER BY id");
  const valid = { team_id: "1", name: "Valid" };
  const cases = [
    [undefined, "Expected a project object"],
    [[], "Expected a project object"],
    [{}, "Invalid team ID"],
    [{ team_id: "1" }, "Invalid name"],
    [{ ...valid, extra: true }, "Unknown project field"],
  ];
  for (const team_id of [
    null,
    true,
    {},
    [],
    "",
    "abc",
    "0",
    "-1",
    "1.5",
    overflowId,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    cases.push([{ ...valid, team_id }, "Invalid team ID"]);
  }
  for (const name of [null, 42, {}, [], "", "  ", "bad\0name"]) {
    cases.push([{ ...valid, name }, "Invalid name"]);
  }
  for (const description of [null, 42, {}, [], "bad\0description"]) {
    cases.push([{ ...valid, description }, "Invalid description"]);
  }
  for (const [body, error] of cases) {
    assert.deepEqual(await request("POST", "/api/projects", 400, { body }), {
      error,
    });
  }
  assert.deepEqual(
    await queryRows("SELECT * FROM projects ORDER BY id"),
    before,
  );
});

testEndpointAccess([
  {
    method: "GET",
    url: "/api/projects/:id/tasks",
    id: "1",
    resource: "Project",
  },
  {
    method: "POST",
    url: "/api/projects/:id/tasks",
    id: "1",
    resource: "Project",
    body: { title: "Created" },
  },
  { method: "GET", url: "/api/projects/:id", id: "1", resource: "Project" },
  {
    method: "PATCH",
    url: "/api/projects/:id",
    id: "1",
    resource: "Project",
    body: { name: "Changed" },
  },
  { method: "DELETE", url: "/api/projects/:id", id: "1", resource: "Project" },
]);

test("GET project tasks returns only tasks in that project and supports empty lists", async () => {
  const tasks = await request("GET", collectionUrl, 200, { user: member });
  assert.equal(tasks.length, 1);
  assertTaskShape(tasks[0]);
  assert.equal(tasks[0].id, "1");
  assert.equal(tasks[0].project_id, "1");
  assert.deepEqual(
    await request("GET", "/api/projects/2/tasks", 200, { user: member }),
    [],
  );
});

test("GET project tasks searches titles and descriptions with case-insensitive full-text matching", async () => {
  const tasks = await request("GET", collectionUrl, 200, { user: member });
  for (const keyword of ["PRIMARY", "descriptions", '"task description"']) {
    const query = new URLSearchParams({ keyword });
    assert.deepEqual(
      await request("GET", `${collectionUrl}?${query}`, 200, { user: member }),
      tasks,
    );
  }

  assert.deepEqual(
    await request("GET", `${collectionUrl}?keyword=other`, 200),
    [],
  );
});

test("GET project tasks filters by assignee and combines filters with AND", async () => {
  const [original] = await request("GET", collectionUrl, 200);
  const otherAssignee = await request("POST", collectionUrl, 201, {
    body: { title: "Primary follow-up", assignee_id: admin },
  });
  const otherKeyword = await request("POST", collectionUrl, 201, {
    body: { title: "Review", assignee_id: member },
  });
  await request("POST", collectionUrl, 201, {
    body: { title: "Primary unassigned" },
  });

  const assigneeQuery = `${collectionUrl}?assignee_id=${member}`;
  const assigned = await request("GET", assigneeQuery, 200, { user: member });
  assert.deepEqual(assigned, [otherKeyword, original]);
  assert.deepEqual(
    await request("GET", `${assigneeQuery}&keyword=primary`, 200),
    [original],
  );
  assert.deepEqual(
    await request(
      "GET",
      `${collectionUrl}?assignee_id=${admin}&keyword=primary`,
      200,
    ),
    [otherAssignee],
  );
  assert.deepEqual(
    await request("GET", `${assigneeQuery}&keyword=missing`, 200),
    [],
  );
  assert.deepEqual(
    await request("GET", `${collectionUrl}?assignee_id=${outsider}`, 200),
    [],
  );
});

test("GET project tasks validates filter inputs", async () => {
  for (const invalidId of [
    "",
    "abc",
    "0",
    "-1",
    overflowId,
    "1&assignee_id=2",
  ]) {
    const response = await request(
      "GET",
      `${collectionUrl}?assignee_id=${invalidId}`,
      400,
    );
    assert.deepEqual(response, { error: "Invalid assignee ID" });
  }

  for (const query of ["keyword=first&keyword=second", "keyword=%00"]) {
    assert.deepEqual(await request("GET", `${collectionUrl}?${query}`, 400), {
      error: "Invalid keyword",
    });
  }
});

test("GET project tasks enforces authentication and team membership with filters", async () => {
  const url = `${collectionUrl}?keyword=primary&assignee_id=${member}`;
  await request("GET", url, 401, { user: null });
  await request("GET", url, 403, { user: outsider });
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
  assert.deepEqual(
    await request("PATCH", projectUrl, 403, { user: member, body }),
    {
      error: "Admin permission required",
    },
  );
  assert.deepEqual(await request("GET", projectUrl, 200), before);
  const renamed = await request("PATCH", projectUrl, 200, { body });
  assertProjectShape(renamed);
  assert.deepEqual(renamed, { ...before, ...body });

  const cleared = await request("PATCH", projectUrl, 200, {
    body: { description: "" },
  });
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
    assert.deepEqual(await request("POST", collectionUrl, 400, { body }), {
      error,
    });
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
    assert.deepEqual(await request("PATCH", projectUrl, 400, { body }), {
      error,
    });
  }
  assert.deepEqual(await request("GET", projectUrl, 200), before);
});

test("POST rejects an assignee ID outside the BIGINT range", async () => {
  const body = { title: "Invalid assignee", assignee_id: overflowId };
  assert.deepEqual(await request("POST", collectionUrl, 400, { body }), {
    error: "Invalid assignee ID",
  });
});
