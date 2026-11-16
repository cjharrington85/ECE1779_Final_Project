const express = require("express");
const projectService = require("../services/project-service");
const taskService = require("../services/task-service");
const authorizeTask = require("../middleware/task-authorization");
const {
  validateProjectId,
  validateTask,
} = require("../middleware/task-validation");
const { authorizeProject } = require("../middleware/project-authorization");

const router = express.Router();

/* Get all tasks in a project */
router.get(
  "/:projectId/tasks",
  validateProjectId,
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

// Create a task
router.post(
  "/:projectId/tasks",
  validateProjectId,
  authorizeTask("member"),
  validateTask,
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

const sendProjectMutation = async (req, res, project) => {
  if (project) {
    return res.status(200).json(project);
  }

  const current = await projectService.getProjectWithRole(
    req.params.projectId,
    req.user.id,
  );
  if (!current) {
    return res.status(404).json({ error: "Project not found" });
  }

  return res.status(403).json({ error: "Admin permission required" });
};

router.get("/:projectId", authorizeProject("member"), (req, res) => {
  return res.status(200).json(req.project);
});

router.patch("/:projectId", authorizeProject("admin"), async (req, res) => {
  const body = req.body || {};
  const fields = Object.keys(body);

  if (Array.isArray(body) || fields.length === 0) {
    return res
      .status(400)
      .json({ error: "Expected a non-empty project object" });
  }

  if (fields.some((field) => field !== "name" && field !== "description")) {
    return res.status(400).json({ error: "Unknown project field" });
  }

  const { name, description } = body;
  if (
    name !== undefined &&
    (typeof name !== "string" || name.trim() === "" || name.includes("\0"))
  ) {
    return res.status(400).json({ error: "Invalid name" });
  }

  if (
    description !== undefined &&
    (typeof description !== "string" || description.includes("\0"))
  ) {
    return res.status(400).json({ error: "Invalid description" });
  }

  try {
    const project = await projectService.updateProject(
      req.params.projectId,
      req.user.id,
      body,
    );
    return await sendProjectMutation(req, res, project);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:projectId", authorizeProject("admin"), async (req, res) => {
  try {
    const project = await projectService.deleteProject(
      req.params.projectId,
      req.user.id,
    );
    return await sendProjectMutation(req, res, project);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
