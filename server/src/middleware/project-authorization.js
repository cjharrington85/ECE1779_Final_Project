const { pool } = require("../db");
const projectService = require("../services/project-service");
const { isValidId } = require("../utils/validation");

/* Authorize access to an individual project */
const authorizeProject = (requiredRole) => async (req, res, next) => {
  const { projectId } = req.params;
  if (!isValidId(projectId)) {
    return res.status(400).json({ error: "Invalid project ID" });
  }

  try {
    const result = await projectService.getProjectWithRole(
      projectId,
      req.user.id,
    );

    if (!result) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { role, ...project } = result;
    if (!role) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (requiredRole === "admin" && role !== "admin") {
      return res.status(403).json({ error: "Admin permission required" });
    }

    req.project = project;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { authorizeProject };
