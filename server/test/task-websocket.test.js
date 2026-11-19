const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const {
  getServer,
  tokenFor,
  request,
  queryRows,
  admin,
  member,
  outsider,
} = require("./route-test-support");
let startTaskListener;
let wss;
let listener;

async function setup(t) {
  const attachTaskWebSocket = require("../src/task-websocket");
  startTaskListener = require("../src/task-listener");
  wss = attachTaskWebSocket(getServer());
  listener = await startTaskListener(wss);
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await listener.end();
    await new Promise((resolve) => wss.close(resolve));
  });
}

async function connect(t) {
  const ws = new WebSocket(`ws://127.0.0.1:${getServer().address().port}`);
  t.after(() => ws.terminate());
  await once(ws, "open", { signal: AbortSignal.timeout(3000) });
  return ws;
}
function nextMessage(ws) {
  return once(ws, "message", { signal: AbortSignal.timeout(3000) }).then(
    ([data]) => JSON.parse(data.toString()),
  );
}
async function send(ws, message) {
  const response = nextMessage(ws);
  ws.send(typeof message === "string" ? message : JSON.stringify(message));
  return response;
}
async function subscribe(ws, user, project = "1") {
  assert.equal(
    (await send(ws, { type: "auth", token: tokenFor(user) })).type,
    "authenticated",
  );
  assert.deepEqual(await send(ws, { type: "subscribe", project_id: project }), {
    type: "subscribed",
    project_id: project,
  });
}

test("WebSocket validates messages, identity and project membership", async (t) => {
  await setup(t);
  const ws = await connect(t);
  assert.equal((await send(ws, "{")).error, "Invalid message");
  assert.equal((await send(ws, "null")).error, "Invalid message");
  assert.equal(
    (await send(ws, { type: "subscribe", project_id: "1" })).error,
    "Authentication required",
  );
  for (const token of [
    "invalid",
    tokenFor("999"),
    tokenFor(1),
    jwt.sign({ id: admin, exp: 1 }, process.env.JWT_SECRET),
  ]) {
    assert.equal(
      (await send(ws, { type: "auth", token })).error,
      "Authentication failed",
    );
  }
  await send(ws, { type: "auth", token: tokenFor(outsider) });
  assert.equal(
    (await send(ws, { type: "subscribe", project_id: "1" })).error,
    "Access denied",
  );
  assert.equal(
    (await send(ws, { type: "subscribe", project_id: "0" })).error,
    "Invalid project ID",
  );
  await subscribe(ws, member);
  assert.equal(
    (await send(ws, { type: "unknown" })).error,
    "Unknown message type",
  );
  assert.equal((await send(ws, { type: "unsubscribe" })).type, "unsubscribed");
  await subscribe(ws, admin);
  await send(ws, { type: "auth", token: "invalid" });
  assert.equal(
    (await send(ws, { type: "subscribe", project_id: "1" })).error,
    "Authentication required",
  );
});

test("committed task changes reach only authorized subscribers across replicas", async (t) => {
  await setup(t);
  const ws = await connect(t);
  const other = await connect(t);
  const unauthenticated = await connect(t);
  await subscribe(ws, member);
  await subscribe(other, outsider, "3");
  const unexpected = [];
  other.on("message", (data) => unexpected.push(String(data)));
  unauthenticated.on("message", (data) => unexpected.push(String(data)));

  // A second LISTEN connection represents a second API replica.
  const replica = {
    userId: admin,
    projectId: "1",
    expiresAt: null,
    readyState: WebSocket.OPEN,
    send: (data) => replicaEvents.push(JSON.parse(data)),
  };
  const replicaEvents = [];
  const secondListener = await startTaskListener({
    clients: new Set([replica]),
  });
  t.after(() => secondListener.end());

  let event = nextMessage(ws);
  const task = await request("POST", "/api/projects/1/tasks", 201, {
    body: { title: "Live task" },
  });
  assert.deepEqual(await event, {
    op: "INSERT",
    task_id: Number(task.id),
    project_id: 1,
    team_id: 1,
  });
  event = nextMessage(ws);
  await request("PATCH", `/api/tasks/${task.id}`, 200, {
    body: { status: "done" },
  });
  assert.equal((await event).op, "UPDATE");
  event = nextMessage(ws);
  await request("DELETE", `/api/tasks/${task.id}`, 200);
  assert.equal((await event).op, "DELETE");

  const blocked = [];
  ws.on("message", (data) => blocked.push(String(data)));
  await queryRows("DELETE FROM team_members WHERE team_id = 1 AND user_id = 2");
  await request("PATCH", "/api/tasks/1", 200, {
    body: { title: "After removal" },
  });
  // Wait until the other replica has processed the final notification.
  for (let i = 0; i < 50 && replicaEvents.length < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(
    replicaEvents.map((item) => item.op),
    ["INSERT", "UPDATE", "DELETE", "UPDATE"],
  );
  assert.deepEqual(unexpected, []);
  assert.deepEqual(blocked, []);
});
