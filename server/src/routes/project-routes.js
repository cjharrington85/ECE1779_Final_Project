const express = require("express");
const projectService = require("../services/project-service");
const taskService = require("../services/task-service");
const authorizeTask = require("../middleware/task-authorization");
const {
  validateProjectId,
  validateTask,
} = require("../middleware/task-validation");
const { authorizeProject } = require("../middleware/project-authorization");
const { isValidId } = require("../utils/validation");

const router = express.Router();

router.post("/", async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Expected a project object" });
  }

  if (
    Object.keys(body).some(
      (field) => !["team_id", "name", "description"].includes(field),
    )
  ) {
    return res.status(400).json({ error: "Unknown project field" });
  }

  const { team_id, name, description } = body;
  const teamId =
    typeof team_id === "number" && Number.isSafeInteger(team_id)
      ? String(team_id)
      : team_id;
  if (!isValidId(teamId)) {
    return res.status(400).json({ error: "Invalid team ID" });
  }
  if (typeof name !== "string" || name.trim() === "" || name.includes("\0")) {
    return res.status(400).json({ error: "Invalid name" });
  }
  if (
    description !== undefined &&
    (typeof description !== "string" || description.includes("\0"))
  ) {
    return res.status(400).json({ error: "Invalid description" });
  }

  try {
    const project = await projectService.createProject(req.user.id, {
      ...body,
      team_id: teamId,
    });
    if (!project) {
      if (!(await projectService.teamExists(teamId))) {
        return res.status(404).json({ error: "Team not found" });
      }
      return res.status(403).json({ error: "Admin permission required" });
    }
    return res.status(201).json(project);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* Get all tasks in a project */
router.get(
  "/:projectId/tasks",
  validateProjectId,
  authorizeTask("member"),
  async (req, res) => {
    const { keyword, assignee_id } = req.query;
    if (assignee_id !== undefined && !isValidId(assignee_id)) {
      return res.status(400).json({ error: "Invalid assignee ID" });
    }

    if (
      keyword !== undefined &&
      (typeof keyword !== "string" || keyword.includes("\0"))
    ) {
      return res.status(400).json({ error: "Invalid keyword" });
    }

    try {
      const tasks = await taskService.getTasks(req.params.projectId, {
        keyword,
        assigneeId: assignee_id,
      });
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
