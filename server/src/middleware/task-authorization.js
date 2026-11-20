const { pool } = require("../db");

/* Authorize admin operations */
const authorizeTask = (requiredRole = "member") => {
  return async (req, res, next) => {
    try {
      // Get user id
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          error: "Authentication required",
        });
      }

      // Get project id
      let projectId = req.params.projectId;
      if (!projectId) {
        // If `projectId` is not provided, get it from the table `tasks`
        const result = await pool.query(
          "SELECT project_id FROM tasks WHERE id = $1",
          [req.params.taskId],
        );

        if (result.rows.length === 0) {
          return res.status(404).json({
            error: "Task not found",
          });
        }

        projectId = result.rows[0].project_id;
      }

      // Check team membership and role
      const result = await pool.query(
        `SELECT tm.role
         FROM projects p
         JOIN team_members tm ON p.team_id = tm.team_id
         WHERE p.id = $1 AND tm.user_id = $2`,
        [projectId, userId],
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          error: "Access denied",
        });
      }

      const role = result.rows[0].role;

      if (requiredRole === "admin" && role !== "admin") {
        return res.status(403).json({
          error: "Admin permission required",
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = authorizeTask;
