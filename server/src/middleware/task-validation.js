const pool = require("../db");

const validateTask = () => {
  return async (req, res, next) => {
    try {
      // Reject unknown fields
      const allowedFields = [
        "title",
        "description",
        "status",
        "priority",
        "assignee_id",
        "due_date",
      ];

      if (Object.keys(req.body).some((key) => !allowedFields.includes(key))) {
        return res.status(400).json({ error: "Unknown task field" });
      }

      const { title, description, priority, status, assignee_id, due_date } =
        req.body;

      const validPriorities = ["low", "medium", "high", "urgent"];
      const validStatus = ["todo", "in_progress", "done"];

      // Validate title
      if (
        (req.method === "POST" && title === undefined) ||
        (title !== undefined &&
          (typeof title !== "string" || title.trim() === ""))
      ) {
        return res.status(400).json({
          error: "Invalid title",
        });
      }

      // Validate description
      if (description !== undefined && typeof description !== "string") {
        return res.status(400).json({
          error: "Invalid description",
        });
      }

      // Validate priority
      if (priority !== undefined && !validPriorities.includes(priority)) {
        return res.status(400).json({
          error: "Invalid priority",
        });
      }

      // Validate status
      if (status !== undefined && !validStatus.includes(status)) {
        return res.status(400).json({
          error: "Invalid status",
        });
      }

      // Validate assignee
      if (assignee_id !== undefined && assignee_id !== null) {
        if (!(
          (typeof assignee_id === "number" &&
            Number.isSafeInteger(assignee_id) &&
            assignee_id > 0) ||
          (typeof assignee_id === "string" && /^[1-9]\d*$/.test(assignee_id))
        )) {
          return res.status(400).json({ error: "Invalid assignee ID" });
        }

        let projectId = req.params.projectId;
        if (!projectId) {
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

        const result = await pool.query(
          `SELECT tm.role
           FROM projects p
           JOIN team_members tm ON p.team_id = tm.team_id
           WHERE p.id = $1 AND tm.user_id = $2`,
          [projectId, assignee_id],
        );

        if (result.rows.length === 0) {
          return res.status(400).json({
            error: "Assignee is not a team member",
          });
        }
      }

      // Validate due date
      if (
        due_date !== undefined &&
        due_date !== null &&
        (typeof due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due_date))
      ) {
        return res.status(400).json({ error: "Invalid due date" });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = validateTask;
