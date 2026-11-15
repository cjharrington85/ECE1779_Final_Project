const express = require("express");
const taskService = require("../services/task-service");
const authorizeTask = require("../middleware/task-authorization");
const validateTask = require("../middleware/task-validation");

const router = express.Router();

/* Get all tasks in a project */
router.get(
  "/projects/:projectId",
  authorizeTask("member"),
  async (req, res) => {
    try {
      const tasks = await taskService.getTasks(req.params.projectId);
      return res.status(200).json(tasks);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get("/:taskId", authorizeTask("member"), async (req, res) => {
  try {
    const task = await taskService.getTaskById(req.params.taskId);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    return res.status(200).json(task);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create a task
router.post(
  "/projects/:projectId",
  authorizeTask("member"),
  validateTask(),
  async (req, res) => {
    try {
      const task = await taskService.createTask(
        req.params.projectId,
        req.body,
        req.user.id,
      );

      return res.status(201).json(task);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* Update a task */
router.patch(
  "/:taskId",
  authorizeTask("member"),
  validateTask(),
  async (req, res) => {
    try {
      const task = await taskService.updateTask(req.params.taskId, req.body);

      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      return res.status(200).json(task);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* Delete a task */
router.delete("/:taskId", authorizeTask("admin"), async (req, res) => {
  try {
    const task = await taskService.deleteTask(req.params.taskId, req.body);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    return res.status(200).json(task);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
