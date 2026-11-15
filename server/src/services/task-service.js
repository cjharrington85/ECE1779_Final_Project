const pool = require("../db");

/* Get all tasks in a project */
const getTasks = async (projectId) => {
  const result = await pool.query(
    "SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId],
  );
  return result.rows;
};

/* Get a single task */
const getTaskById = async (taskId) => {
  const result = await pool.query("SELECT * FROM tasks WHERE id = $1", [
    taskId,
  ]);
  return result.rows[0] || null;
};

/* Create a task */
const createTask = async (projectId, data, userId) => {
  const { title, description, priority, status, assignee_id, due_date } = data;

  const result = await pool.query(
    `INSERT INTO tasks
      (project_id, title, description, priority, status, assignee_id, due_date, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
    [
      projectId,
      title,
      description ?? "",
      priority ?? "medium",
      status ?? "todo",
      assignee_id ?? null,
      due_date ?? null,
      userId,
    ],
  );

  return result.rows[0];
};

/* Update a task */
const updateTask = async (taskId, data) => {
  const existing = await getTaskById(taskId);
  if (!existing) {
    return null;
  }

  const updated = {
    title: data.title !== undefined ? data.title : existing.title,
    description:
      data.description !== undefined ? data.description : existing.description,
    priority: data.priority !== undefined ? data.priority : existing.priority,
    status: data.status !== undefined ? data.status : existing.status,
    assignee_id:
      data.assignee_id !== undefined ? data.assignee_id : existing.assignee_id,
    due_date: data.due_date !== undefined ? data.due_date : existing.due_date,
  };

  const result = await pool.query(
    `UPDATE tasks
    SET title = $1,
        description = $2,
        priority = $3,
        status = $4,
        assignee_id = $5,
        due_date = $6
    WHERE id = $7
    RETURNING *`,
    [
      updated.title,
      updated.description,
      updated.priority,
      updated.status,
      updated.assignee_id,
      updated.due_date,
      taskId,
    ],
  );

  return result.rows[0] || null;
};

/* Delete a task */
async function deleteTask(taskId) {
  const result = await pool.query(
    "DELETE FROM tasks WHERE id = $1 RETURNING *",
    [taskId],
  );
  return result.rows[0] || null;
}

module.exports = {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
};
