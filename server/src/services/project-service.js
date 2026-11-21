const { pool } = require("../db");

const teamExists = async (teamId) => {
  const result = await pool.query("SELECT id FROM teams WHERE id = $1", [
    teamId,
  ]);
  return result.rows.length > 0;
};

const createProject = async (userId, { team_id, name, description = "" }) => {
  const result = await pool.query(
    `INSERT INTO projects (team_id, name, description)
     SELECT $1, $3, $4
     WHERE EXISTS (
       SELECT 1 FROM team_members
       WHERE team_id = $1
         AND user_id = $2
         AND role = 'admin'
     )
     RETURNING *`,
    [team_id, userId, name, description],
  );

  return result.rows[0] ?? null;
};

const getProjectWithRole = async (projectId, userId) => {
  const result = await pool.query(
    `SELECT p.*, tm.role
     FROM projects p
     LEFT JOIN team_members tm ON tm.team_id = p.team_id AND tm.user_id = $2
     WHERE p.id = $1`,
    [projectId, userId],
  );

  return result.rows[0] || null;
};

const updateProject = async (projectId, userId, { name, description }) => {
  const result = await pool.query(
    `UPDATE projects p
     SET name = COALESCE($3, p.name),
         description = COALESCE($4, p.description)
     FROM team_members tm
     WHERE p.id = $1 AND tm.team_id = p.team_id
       AND tm.user_id = $2 AND tm.role = 'admin'
     RETURNING p.*`,
    [projectId, userId, name ?? null, description ?? null],
  );

  return result.rows[0] || null;
};

const deleteProject = async (projectId, userId) => {
  const result = await pool.query(
    `DELETE FROM projects p
     USING team_members tm
     WHERE p.id = $1 AND tm.team_id = p.team_id
       AND tm.user_id = $2 AND tm.role = 'admin'
     RETURNING p.*`,
    [projectId, userId],
  );

  return result.rows[0] || null;
};

module.exports = {
  teamExists,
  createProject,
  getProjectWithRole,
  updateProject,
  deleteProject,
};
