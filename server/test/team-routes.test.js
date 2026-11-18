const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  admin,
  member,
  outsider,
  request,
  queryRows,
  testEndpointAuthentication,
  missingId,
  overflowId,
} = require("./route-test-support");

const teamsUrl = "/api/teams";
const teamUrl = `${teamsUrl}/1`;
const membersUrl = `${teamUrl}/members`;
const memberUrl = `${membersUrl}/${member}`;
const rename = { name: "Renamed team" };
const promotion = { role: "admin" };

for (const [method, url, body] of [
  ["GET", teamsUrl],
  ["POST", teamsUrl, { name: "New team" }],
  ["PATCH", teamUrl, rename],
  ["DELETE", teamUrl],
  ["GET", membersUrl],
  ["POST", membersUrl, { userId: outsider }],
  ["PATCH", memberUrl, promotion],
  ["DELETE", memberUrl],
]) {
  testEndpointAuthentication(method, url, body);
}

function teams() {
  return queryRows("SELECT * FROM teams ORDER BY id");
}

function memberships() {
  return queryRows("SELECT * FROM team_members ORDER BY team_id, user_id");
}

test("POST team trims the name and makes the creator an admin", async () => {
  const name = "x".repeat(100);
  const { team, ...extra } = await request("POST", teamsUrl, 201, {
    user: outsider,
    body: { name: `  ${name}  ` },
  });
  const [stored] = await queryRows("SELECT * FROM teams WHERE id = $1", [team.id]);
  assert.deepEqual(extra, {});
  assert.deepEqual(team, {
    id: stored.id,
    name,
    created_by: outsider,
    created_at: stored.created_at.toISOString(),
  });
  assert.equal(stored.name, name);
  assert.equal(stored.created_by, outsider);
  assert.deepEqual(
    await queryRows(
      "SELECT user_id, role FROM team_members WHERE team_id = $1",
      [team.id],
    ),
    [{ user_id: outsider, role: "admin" }],
  );
});

test("GET teams returns only the caller's memberships with their per-team roles", async () => {
  const [primary, other] = await teams();
  const asListed = (team, role) => ({
    ...team,
    created_at: team.created_at.toISOString(),
    role,
  });
  const result = await request("GET", teamsUrl, 200, { user: member });
  result.teams.sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(result, {
    teams: [asListed(primary, "member"), asListed(other, "admin")],
  });
  assert.deepEqual(await request("GET", teamsUrl, 200, { user: outsider }), {
    teams: [asListed(other, "admin")],
  });
  await request("DELETE", `${teamsUrl}/2/members/${outsider}`, 200, { user: member });
  assert.deepEqual(await request("GET", teamsUrl, 200, { user: outsider }), {
    teams: [],
  });
});

test("POST and PATCH team reject invalid names without changing teams or memberships", async () => {
  const beforeTeams = await teams();
  const beforeMembers = await memberships();
  for (const body of [undefined, {}, { name: " " }, { name: 1 }, { name: "x".repeat(101) }]) {
    for (const [method, url] of [["POST", teamsUrl], ["PATCH", teamUrl]]) {
      assert.deepEqual(await request(method, url, 400, { body }), {
        error: "Team name must be between 1 and 100 characters",
      });
    }
  }
  assert.deepEqual(await teams(), beforeTeams);
  assert.deepEqual(await memberships(), beforeMembers);
});

test("PATCH team persists the trimmed name and preserves the other teams and fields", async () => {
  const [primary, other] = await teams();
  const updated = { ...primary, name: rename.name };
  assert.deepEqual(await request("PATCH", teamUrl, 200, {
    body: { name: `  ${rename.name}  ` },
  }), {
    team: { ...updated, created_at: primary.created_at.toISOString() },
  });
  assert.deepEqual(await teams(), [updated, other]);
});

test("DELETE team cascades to its memberships, projects and tasks", async () => {
  const [, other] = await teams();
  const otherMemberships = (await memberships()).filter(({ team_id }) => team_id === other.id);
  const otherProjects = await queryRows("SELECT * FROM projects WHERE team_id = $1", [other.id]);
  const otherTasks = await queryRows("SELECT * FROM tasks WHERE project_id = $1", [
    otherProjects[0].id,
  ]);
  assert.deepEqual(await request("DELETE", teamUrl, 200), {
    message: "Team deleted successfully",
    team: { id: "1", name: "Primary team" },
  });
  assert.deepEqual(await teams(), [other]);
  assert.deepEqual(await memberships(), otherMemberships);
  assert.deepEqual(await queryRows("SELECT * FROM projects ORDER BY id"), otherProjects);
  assert.deepEqual(await queryRows("SELECT * FROM tasks ORDER BY id"), otherTasks);
});

test("GET team members lets a regular member see only that team's roster", async () => {
  const [adminMembership, memberMembership] = await memberships();
  const result = await request("GET", membersUrl, 200, { user: member });
  result.members.sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(result, {
    members: [
      {
        id: admin,
        username: "admin",
        email: "admin@example.test",
        role: "admin",
        joined_at: adminMembership.joined_at.toISOString(),
      },
      {
        id: member,
        username: "member",
        email: "member@example.test",
        role: "member",
        joined_at: memberMembership.joined_at.toISOString(),
      },
    ],
  });
  assert.deepEqual(await request("GET", membersUrl, 403, { user: outsider }), {
    error: "You are not a member of this team",
  });
});

test("POST team members adds an existing user as a member and rejects duplicates", async () => {
  const before = await memberships();
  const { member: added, ...extra } = await request("POST", membersUrl, 201, {
    body: { userId: Number(outsider) },
  });
  const [stored] = await queryRows(
    "SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2",
    ["1", outsider],
  );
  assert.deepEqual(extra, {});
  assert.deepEqual(added, {
    team_id: "1",
    user_id: outsider,
    role: "member",
    joined_at: stored.joined_at.toISOString(),
  });
  assert.deepEqual(stored, { ...added, joined_at: stored.joined_at });
  for (const userId of [outsider, admin]) {
    assert.deepEqual(await request("POST", membersUrl, 409, { body: { userId } }), {
      error: "User is already a team member",
    });
  }
  assert.deepEqual(await memberships(), [...before.slice(0, 2), stored, ...before.slice(2)]);
});

test("Team mutations reject both regular members and admins of another team", async () => {
  const beforeTeams = await teams();
  const beforeMembers = await memberships();
  for (const user of [member, outsider]) {
    for (const [method, url, body, error] of [
      ["PATCH", teamUrl, rename, "Team not found or admin access required"],
      ["DELETE", teamUrl, undefined, "Team not found or admin access required"],
      ["POST", membersUrl, { userId: outsider }, "Only team admins can add members"],
      ["PATCH", memberUrl, promotion, "Only team admins can change roles"],
      ["DELETE", memberUrl, undefined, "Only team admins can remove members"],
    ]) {
      assert.deepEqual(await request(method, url, 403, { user, body }), { error });
    }
  }
  assert.deepEqual(await teams(), beforeTeams);
  assert.deepEqual(await memberships(), beforeMembers);
});

test("Team routes validate both path and body IDs before modifying data", async () => {
  const beforeTeams = await teams();
  const beforeMembers = await memberships();
  for (const invalid of ["abc", "0", "-1", overflowId]) {
    const invalidTeam = `${teamsUrl}/${invalid}`;
    for (const [method, url, body, error] of [
      ["PATCH", invalidTeam, rename, "Invalid team ID"],
      ["DELETE", invalidTeam, undefined, "Invalid team ID"],
      ["GET", `${invalidTeam}/members`, undefined, "Invalid team ID"],
      ["POST", `${invalidTeam}/members`, { userId: outsider }, "Valid teamId and userId are required"],
      ["POST", membersUrl, { userId: invalid }, "Valid teamId and userId are required"],
      ["PATCH", `${invalidTeam}/members/${member}`, promotion, "Invalid team or user ID"],
      ["PATCH", `${membersUrl}/${invalid}`, promotion, "Invalid team or user ID"],
      ["DELETE", `${invalidTeam}/members/${member}`, undefined, "Invalid team or user ID"],
      ["DELETE", `${membersUrl}/${invalid}`, undefined, "Invalid team or user ID"],
    ]) {
      assert.deepEqual(await request(method, url, 400, { body }), { error });
    }
  }
  assert.deepEqual(await request("POST", membersUrl, 400, { body: {} }), {
    error: "Valid teamId and userId are required",
  });
  assert.deepEqual(await teams(), beforeTeams);
  assert.deepEqual(await memberships(), beforeMembers);
});

test("Team routes return their endpoint-specific errors for nonexistent resources", async () => {
  const beforeTeams = await teams();
  const beforeMembers = await memberships();
  const missingTeam = `${teamsUrl}/${missingId}`;
  for (const [method, url, status, body, error] of [
    ["PATCH", missingTeam, 403, rename, "Team not found or admin access required"],
    ["DELETE", missingTeam, 403, undefined, "Team not found or admin access required"],
    ["GET", `${missingTeam}/members`, 403, undefined, "You are not a member of this team"],
    ["POST", `${missingTeam}/members`, 403, { userId: outsider }, "Only team admins can add members"],
    ["POST", membersUrl, 404, { userId: missingId }, "Team or user not found"],
    ["PATCH", `${missingTeam}/members/${member}`, 404, promotion, "Team not found"],
    ["DELETE", `${missingTeam}/members/${member}`, 404, undefined, "Team not found"],
    ["PATCH", `${membersUrl}/${outsider}`, 404, promotion, "Team member not found"],
    ["DELETE", `${membersUrl}/${outsider}`, 404, undefined, "Team member not found"],
  ]) {
    assert.deepEqual(await request(method, url, status, { body }), { error });
  }
  assert.deepEqual(await teams(), beforeTeams);
  assert.deepEqual(await memberships(), beforeMembers);
});

test("PATCH team member rejects missing or invalid roles without changing memberships", async () => {
  const before = await memberships();
  for (const body of [undefined, {}, { role: null }, { role: "owner" }, { role: "Admin" }]) {
    assert.deepEqual(await request("PATCH", memberUrl, 400, { body }), {
      error: "Role must be admin or member",
    });
  }
  assert.deepEqual(await memberships(), before);
});

test("PATCH team member transfers admin authority once a second admin exists", async () => {
  const before = await memberships();
  const [originalAdmin, originalMember] = before;
  assert.deepEqual(await request("PATCH", memberUrl, 200, { body: promotion }), {
    member: { team_id: "1", user_id: member, role: "admin" },
  });
  assert.deepEqual(await request("PATCH", `${membersUrl}/${admin}`, 200, {
    user: member,
    body: { role: "member" },
  }), {
    member: { team_id: "1", user_id: admin, role: "member" },
  });
  assert.deepEqual(await memberships(), [
    { ...originalAdmin, role: "member" },
    { ...originalMember, role: "admin" },
    ...before.slice(2),
  ]);
  assert.deepEqual(await request("PATCH", teamUrl, 403, { body: rename }), {
    error: "Team not found or admin access required",
  });
});

test("DELETE team member removes a regular member and an admin when another admin remains", async () => {
  const before = await memberships();
  for (const [url, user, target, teamId, role] of [
    [memberUrl, admin, member, "1", "member"],
    [`${teamsUrl}/2/members/${outsider}`, member, outsider, "2", "admin"],
  ]) {
    assert.deepEqual(await request("DELETE", url, 200, { user }), {
      message: "Team member removed successfully",
      member: { team_id: teamId, user_id: target, role },
    });
    assert.deepEqual(await request("GET", `${teamsUrl}/${teamId}/members`, 403, {
      user: target,
    }), { error: "You are not a member of this team" });
  }
  assert.deepEqual(await memberships(), [before[0], before[2]]);
});

test("The last admin of a team cannot be demoted or removed", async () => {
  const before = await memberships();
  const adminUrl = `${membersUrl}/${admin}`;
  assert.deepEqual(await request("PATCH", adminUrl, 409, { body: { role: "member" } }), {
    error: "Cannot demote the last team admin",
  });
  assert.deepEqual(await memberships(), before);
  assert.deepEqual(await request("DELETE", adminUrl, 409), {
    error: "Cannot remove the last team admin",
  });
  assert.deepEqual(await memberships(), before);
});
