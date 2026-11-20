const { Client } = require("pg");
const WebSocket = require("ws");
const { pool, dbConfig } = require("./db");

async function startTaskListener(wss) {
  const client = new Client({
    ...dbConfig,
    keepAlive: true,
  });

  // Fail closed if LISTEN is lost; the process supervisor can restart the replica.
  let failed = false;
  function handleListenerFailure(error) {
    if (failed) {
      return;
    }
    failed = true;
    console.error("Task listener connection failed:", error);
    for (const ws of wss.clients) {
      ws.close(1011, "Task listener unavailable");
    }
    process.exit(1);
  }

  client.on("error", handleListenerFailure);
  client.on("end", () => {
    // pg sets _ending for intentional client.end(), including test teardown.
    if (!client._ending) {
      handleListenerFailure(
        new Error("Task listener connection ended unexpectedly"),
      );
    }
  });

  let pending = Promise.resolve();
  client.on("notification", (msg) => {
    pending = pending
      .then(async () => {
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

          const projectId = String(event.project_id);
          const isSubscribed = (ws) =>
            ws.readyState === WebSocket.OPEN &&
            ws.userId &&
            (ws.expiresAt === null || Date.now() < ws.expiresAt) &&
            ws.projectId === projectId;

          if (![...wss.clients].some(isSubscribed)) return;

          // Recheck current membership so removed members stop receiving events.
          const result = await pool.query(
            "SELECT user_id FROM team_members WHERE team_id = $1",
            [event.team_id],
          );
          const members = new Set(
            result.rows.map((row) => String(row.user_id)),
          );
          for (const ws of wss.clients) {
            if (isSubscribed(ws) && members.has(String(ws.userId))) {
              ws.send(msg.payload);
            }
          }
        } catch (error) {
          console.error("Failed to forward task event:", error);
        }
      })
      .catch((error) => {
        console.error("Notification processing failed:", error);
      });
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
