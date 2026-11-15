const express = require("express");
const taskRoutes = require("./routes/task-routes");

const app = express();

app.use(express.json());

/* Health Check Endpoint */
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

/* TODO: Authentication Middleware */

/* Task Routes */
app.use("/api/tasks", taskRoutes);

module.exports = app;
