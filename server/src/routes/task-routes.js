const express = require("express");
const taskService = require("../services/task-service");
const authorizeTask = require("../middleware/task-authorization");
const {
  validateTaskId,
  validateTask,
} = require("../middleware/task-validation");

const router = express.Router();

router.get(
  "/:taskId",
  validateTaskId,
  authorizeTask("member"),
  async (req, res) => {
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
  },
);

/* Update a task */
router.patch(
  "/:taskId",
  validateTaskId,
  authorizeTask("member"),
  validateTask,
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
router.delete(
  "/:taskId",
  validateTaskId,
  authorizeTask("admin"),
  async (req, res) => {
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
  },
);

module.exports = router;
