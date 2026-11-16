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

// Orin's registration and login APIs
app.use("/api/auth", authRoutes);

// Orin's user management APIs
app.use("/api/users", userRoutes);

// Task and project APIs, protected by authentication
app.use("/api/tasks", authenticate, taskRoutes);
app.use("/api/projects", authenticate, projectRoutes);

// Team management APIs
app.use("/api/teams", teamRoutes);

module.exports = app;
