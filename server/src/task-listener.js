const { Client } = require("pg");
const WebSocket = require("ws");
const pool = require("./db");

async function startTaskListener(wss) {
  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "taskapp",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "taskapp",
  });

  // Fail closed if LISTEN is lost; the process supervisor can restart the replica.
  client.on("error", (error) => {
    console.error("Task listener connection failed:", error);
    for (const ws of wss.clients) ws.close(1011, "Task listener unavailable");
    process.exit(1);
  });

  client.on("notification", async (msg) => {
    if (msg.channel !== "task_events") {
      return;
    }

    try {
      const event = JSON.parse(msg.payload);
      if (
        !event ||
        !["INSERT", "UPDATE", "DELETE"].includes(event.op) ||
        event.project_id == null ||
        event.team_id == null ||
        event.task_id == null
      )
        return;

      // Recheck current membership so removed members stop receiving events.
      const result = await pool.query(
        "SELECT user_id FROM team_members WHERE team_id = $1",
        [event.team_id],
      );
      const members = new Set(result.rows.map((row) => String(row.user_id)));
      for (const ws of wss.clients) {
        if (
          ws.readyState === WebSocket.OPEN &&
          ws.userId &&
          (ws.expiresAt === null || Date.now() < ws.expiresAt) &&
          members.has(String(ws.userId)) &&
          ws.projectId === String(event.project_id)
        ) {
          ws.send(msg.payload);
        }
      }
    } catch (error) {
      console.error("Failed to forward task event:", error);
    }
  });

  try {
    await client.connect();
    await client.query("LISTEN task_events");
  } catch (error) {
    await client.end();
    throw error;
  }
  console.log("Listening for task events");
  return client;
}

module.exports = startTaskListener;
