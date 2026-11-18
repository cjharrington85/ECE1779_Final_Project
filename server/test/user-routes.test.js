const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  admin,
  member,
  outsider,
  request,
  tokenFor,
  queryRows,
  testEndpointAuthentication,
  missingId,
  overflowId,
} = require("./route-test-support");

const profileUrl = "/api/users/me";

for (const [method, body] of [
  ["GET"],
  ["PATCH", { username: "Updated" }],
  ["DELETE"],
]) {
  testEndpointAuthentication(method, profileUrl, body);
}

function users() {
  return queryRows("SELECT * FROM users ORDER BY id");
}

function profile({ id, username, email, created_at }) {
  return { id, username, email, created_at: created_at.toISOString() };
}

test("GET profile returns the authenticated user's public fields", async () => {
  const [, stored] = await users();
  assert.equal(stored.id, member);
  assert.deepEqual(await request("GET", profileUrl, 200, { user: member }), {
    user: profile(stored),
  });
});

test("Profile routes reject tokens with malformed or nonexistent user IDs", async () => {
  const before = await users();
  for (const [method, body] of [
    ["GET"],
    ["PATCH", { username: "Updated" }],
    ["DELETE"],
  ]) {
    for (const user of ["abc", overflowId]) {
      assert.deepEqual(await request(method, profileUrl, 401, { user, body }), {
        error: "Invalid token",
      });
    }
    assert.deepEqual(await request(method, profileUrl, 401, { user: missingId, body }), {
      error: "User account no longer exists",
    });
  }
  assert.deepEqual(await users(), before);
});

test("PATCH profile persists individual and combined updates and normalizes inputs", async () => {
  const [first, original, third] = await users();
  const username = "X".repeat(100);
  const email = `${"a".repeat(241)}@example.test`;
  let updated = original;
  for (const [body, changes] of [
    [{ username: `  ${username}  ` }, { username }],
    [{ email: `  ${email.toUpperCase()}  ` }, { email }],
    [
      { username: "  New Name  ", email: "  NEW@Example.Test  " },
      { username: "New Name", email: "new@example.test" },
    ],
  ]) {
    updated = { ...updated, ...changes };
    const expected = { user: profile(updated) };
    assert.deepEqual(await request("PATCH", profileUrl, 200, {
      user: member,
      body,
    }), expected);
    assert.deepEqual(await request("GET", profileUrl, 200, { user: member }), expected);
    assert.deepEqual(await users(), [first, updated, third]);
  }
});

test("PATCH profile rejects missing or invalid fields without changing the user", async () => {
  const before = await users();
  for (const body of [undefined, {}, { id: admin }]) {
    assert.deepEqual(await request("PATCH", profileUrl, 400, { body }), {
      error: "Provide a username or email to update",
    });
  }
  for (const body of [
    { username: "  " },
    { username: 1 },
    { username: "x".repeat(101) },
    { email: null },
    { email: "user @example.test" },
    { email: "user@example" },
    { email: `${"a".repeat(242)}@example.test` },
    { username: "Valid name", email: "invalid" },
  ]) {
    assert.deepEqual(await request("PATCH", profileUrl, 400, { body }), {
      error: "Invalid username or email",
    });
  }
  assert.deepEqual(await users(), before);
});

test("PATCH profile rejects case-insensitive duplicates and rolls back both fields", async () => {
  const before = await users();
  for (const body of [
    { username: "  MeMbEr  ", email: "available@example.test" },
    { username: "Available", email: "  MEMBER@Example.Test  " },
  ]) {
    assert.deepEqual(await request("PATCH", profileUrl, 409, { body }), {
      error: "Username or email already exists",
    });
    assert.deepEqual(await users(), before);
  }
});

test("DELETE profile blocks admins even when another admin can manage the team", async () => {
  const before = await users();
  const memberships = await queryRows("SELECT * FROM team_members ORDER BY team_id, user_id");
  for (const user of [admin, member]) {
    assert.deepEqual(await request("DELETE", profileUrl, 409, { user }), {
      error: "Delete your teams before deleting your account",
    });
    assert.deepEqual(await request("GET", profileUrl, 200, { user }), {
      user: profile(before.find(({ id }) => id === user)),
    });
  }
  assert.deepEqual(await users(), before);
  assert.deepEqual(
    await queryRows("SELECT * FROM team_members ORDER BY team_id, user_id"),
    memberships,
  );
});

test("DELETE profile removes a non-admin account and rejects its JWT on subsequent requests", async () => {
  await request("PATCH", `/api/teams/2/members/${member}`, 200, {
    user: outsider,
    body: { role: "member" },
  });
  const before = await users();
  const memberships = await queryRows("SELECT * FROM team_members ORDER BY team_id, user_id");
  const token = tokenFor(member);
  assert.deepEqual(await request("DELETE", profileUrl, 200, { token }), {
    message: "User account deleted successfully",
    user: { id: member, username: "member", email: "member@example.test" },
  });
  assert.deepEqual(await users(), before.filter(({ id }) => id !== member));
  assert.deepEqual(
    await queryRows("SELECT * FROM team_members ORDER BY team_id, user_id"),
    memberships.filter(({ user_id }) => user_id !== member),
  );
  assert.deepEqual(await queryRows("SELECT assignee_id, created_by FROM tasks WHERE id = 1"), [
    { assignee_id: null, created_by: admin },
  ]);

  for (const [method, url, body] of [
    ["GET", profileUrl],
    ["PATCH", profileUrl, { username: "Updated" }],
    ["DELETE", profileUrl],
    ["GET", "/api/teams"],
  ]) {
    assert.deepEqual(await request(method, url, 401, { token, body }), {
      error: "User account no longer exists",
    });
  }
});
