const express = require("express");
const pool = require("../db");
const { isValidId } = require("../utils/validation");

const router = express.Router();

// Create a team
router.post("/", async (req, res, next) => {
  const { name } = req.body || {};

  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 100
  ) {
    return res.status(400).json({
      error: "Team name must be between 1 and 100 characters",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const teamResult = await client.query(
      `INSERT INTO teams (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name, created_by, created_at`,
      [name.trim(), req.user.id]
    );

    const team = teamResult.rows[0];

    await client.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [team.id, req.user.id]
    );

    await client.query("COMMIT");
    return res.status(201).json({ team });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

// List teams belonging to the logged-in user
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.created_by,
              t.created_at, tm.role
       FROM teams t
       JOIN team_members tm ON t.id = tm.team_id
       WHERE tm.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    return res.status(200).json({
      teams: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

// Add a user to a team
router.post("/:teamId/members", async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const { userId } = req.body || {};

    // Accept valid numeric or string user IDs
    if (
      !isValidId(teamId) ||
      !isValidId(String(userId ?? ""))
    ) {
      return res.status(400).json({
        error: "Valid teamId and userId are required",
      });
    }

    const adminResult = await pool.query(
      `SELECT role FROM team_members
       WHERE team_id = $1 AND user_id = $2`,
      [teamId, req.user.id]
    );

    if (adminResult.rows[0]?.role !== "admin") {
      return res.status(403).json({
        error: "Only team admins can add members",
      });
    }

    const result = await pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (team_id, user_id) DO NOTHING
       RETURNING team_id, user_id, role, joined_at`,
      [teamId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: "User is already a team member",
      });
    }

    return res.status(201).json({
      member: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(404).json({
        error: "Team or user not found",
      });
    }
    next(error);
  }
});

// List team members
router.get("/:teamId/members", async (req, res, next) => {
  try {
    const { teamId } = req.params;

    if (!isValidId(teamId)) {
      return res.status(400).json({
        error: "Invalid team ID",
      });
    }

    const membership = await pool.query(
      `SELECT 1 FROM team_members
       WHERE team_id = $1 AND user_id = $2`,
      [teamId, req.user.id]
    );

    if (membership.rows.length === 0) {
      return res.status(403).json({
        error: "You are not a member of this team",
      });
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.email,
              tm.role, tm.joined_at
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1
       ORDER BY tm.joined_at ASC`,
      [teamId]
    );

    return res.status(200).json({
      members: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

// Change a team member's role
router.patch("/:teamId/members/:userId", async (req, res, next) => {
  const { teamId, userId } = req.params;
  const { role } = req.body || {};

  if (!isValidId(teamId) || !isValidId(userId)) {
    return res.status(400).json({
      error: "Invalid team or user ID",
    });
  }

  if (role !== "admin" && role !== "member") {
    return res.status(400).json({
      error: "Role must be admin or member",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Lock the team during role changes
    const team = await client.query(
      "SELECT id FROM teams WHERE id = $1 FOR UPDATE",
      [teamId]
    );

    if (team.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Team not found",
      });
    }

    const admin = await client.query(
      `SELECT 1 FROM team_members
       WHERE team_id = $1
         AND user_id = $2
         AND role = 'admin'`,
      [teamId, req.user.id]
    );

    if (admin.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Only team admins can change roles",
      });
    }

    const target = await client.query(
      `SELECT role FROM team_members
       WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );

    if (target.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Team member not found",
      });
    }

    // Protect the last administrator
    if (
      target.rows[0].role === "admin" &&
      role === "member"
    ) {
      const count = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM team_members
         WHERE team_id = $1 AND role = 'admin'`,
        [teamId]
      );

      if (count.rows[0].total <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Cannot demote the last team admin",
        });
      }
    }

    const result = await client.query(
      `UPDATE team_members
       SET role = $1
       WHERE team_id = $2 AND user_id = $3
       RETURNING team_id, user_id, role`,
      [role, teamId, userId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      member: result.rows[0],
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

// Remove a team member
router.delete("/:teamId/members/:userId", async (req, res, next) => {
  const { teamId, userId } = req.params;

  if (!isValidId(teamId) || !isValidId(userId)) {
    return res.status(400).json({
      error: "Invalid team or user ID",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Lock the team during member removal
    const team = await client.query(
      "SELECT id FROM teams WHERE id = $1 FOR UPDATE",
      [teamId]
    );

    if (team.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Team not found",
      });
    }

    const admin = await client.query(
      `SELECT 1 FROM team_members
       WHERE team_id = $1
         AND user_id = $2
         AND role = 'admin'`,
      [teamId, req.user.id]
    );

    if (admin.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Only team admins can remove members",
      });
    }

    const target = await client.query(
      `SELECT role FROM team_members
       WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );

    if (target.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Team member not found",
      });
    }

    // Never remove the last administrator
    if (target.rows[0].role === "admin") {
      const count = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM team_members
         WHERE team_id = $1 AND role = 'admin'`,
        [teamId]
      );

      if (count.rows[0].total <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Cannot remove the last team admin",
        });
      }
    }

    const result = await client.query(
      `DELETE FROM team_members
       WHERE team_id = $1 AND user_id = $2
       RETURNING team_id, user_id, role`,
      [teamId, userId]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Team member removed successfully",
      member: result.rows[0],
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

// Update a team
router.patch("/:teamId", async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const { name } = req.body || {};

    if (!isValidId(teamId)) {
      return res.status(400).json({
        error: "Invalid team ID",
      });
    }

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100
    ) {
      return res.status(400).json({
        error: "Team name must be between 1 and 100 characters",
      });
    }

    const result = await pool.query(
      `UPDATE teams
       SET name = $1
       WHERE id = $2
         AND EXISTS (
           SELECT 1 FROM team_members
           WHERE team_id = $2
             AND user_id = $3
             AND role = 'admin'
         )
       RETURNING id, name, created_by, created_at`,
      [name.trim(), teamId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: "Team not found or admin access required",
      });
    }

    return res.status(200).json({
      team: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// Delete a team
router.delete("/:teamId", async (req, res, next) => {
  try {
    const { teamId } = req.params;

    if (!isValidId(teamId)) {
      return res.status(400).json({
        error: "Invalid team ID",
      });
    }

    const result = await pool.query(
      `DELETE FROM teams
       WHERE id = $1
         AND EXISTS (
           SELECT 1 FROM team_members
           WHERE team_id = $1
             AND user_id = $2
             AND role = 'admin'
         )
       RETURNING id, name`,
      [teamId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: "Team not found or admin access required",
      });
    }

    return res.status(200).json({
      message: "Team deleted successfully",
      team: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
