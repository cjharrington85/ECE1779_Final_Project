const express = require("express");
const taskRoutes = require("./routes/task-routes");
const projectRoutes = require("./routes/project-routes");
const authRoutes = require("./routes/auth-routes");
const userRoutes = require("./routes/user-routes");
const authenticate = require("./middleware/auth");
const teamRoutes = require("./routes/team-routes");

const app = express();

app.use(express.json());

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

// Registration and login APIs (public)
app.use("/api/auth", authRoutes);

// User management APIs (authentication required)
app.use("/api/users", authenticate, userRoutes);

// Task and project APIs (authentication required)
app.use("/api/tasks", authenticate, taskRoutes);
app.use("/api/projects", authenticate, projectRoutes);

// Team management APIs (authentication handled in team-routes.js)
app.use("/api/teams", teamRoutes);

module.exports = app;
