const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const pool = require("./db");
const { getProjectWithRole } = require("./services/project-service");
const { isValidId } = require("./utils/validation");

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function attachTaskWebSocket(server) {
  const wss = new WebSocket.Server({ server, maxPayload: 16 * 1024 });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws) => {
    ws.userId = null;
    ws.projectId = null;
    ws.expiresAt = null;
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    let authTimer;
    function requireAuthentication() {
      if (authTimer || ws.readyState !== WebSocket.OPEN) return;
      authTimer = setTimeout(() => {
        ws.terminate();
      }, 10_000);
      authTimer.unref();
    }
    requireAuthentication();
    ws.on("close", () => clearTimeout(authTimer));
    ws.on("error", (error) => console.error("WebSocket error:", error.message));

    async function handleMessage(data) {
      let message;
      try {
        message = JSON.parse(data.toString());
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          throw new Error("Invalid message");
        }
      } catch {
        return send(ws, { type: "error", error: "Invalid message" });
      }

      if (message.type === "auth") {
        // Reauthentication always clears the previous identity and subscription.
        ws.userId = null;
        ws.projectId = null;
        ws.expiresAt = null;
        requireAuthentication();
        try {
          const decoded = jwt.verify(message.token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
          });
          if (!isValidId(decoded.id)) {
            throw new Error("Invalid user ID");
          }
          const result = await pool.query(
            "SELECT id FROM users WHERE id = $1",
            [decoded.id],
          );
          if (!result.rows.length) {
            throw new Error("User no longer exists");
          }
          if (ws.readyState !== WebSocket.OPEN) {
            return;
          }
          clearTimeout(authTimer);
          authTimer = null;
          ws.userId = decoded.id;
          ws.expiresAt = decoded.exp == null ? null : decoded.exp * 1000;
          return send(ws, { type: "authenticated" });
        } catch {
          return send(ws, { type: "error", error: "Authentication failed" });
        }
      }

      if (!ws.userId || (ws.expiresAt !== null && Date.now() >= ws.expiresAt)) {
        ws.userId = null;
        ws.projectId = null;
        requireAuthentication();
        return send(ws, { type: "error", error: "Authentication required" });
      }

      if (message.type === "subscribe") {
        ws.projectId = null;
        const projectId = String(message.project_id);
        if (!isValidId(projectId)) {
          return send(ws, { type: "error", error: "Invalid project ID" });
        }
        const project = await getProjectWithRole(projectId, ws.userId);
        if (!project?.role) {
          return send(ws, { type: "error", error: "Access denied" });
        }
        ws.projectId = projectId;
        return send(ws, { type: "subscribed", project_id: projectId });
      }

      if (message.type === "unsubscribe") {
        ws.projectId = null;
        return send(ws, { type: "unsubscribed" });
      }
      send(ws, { type: "error", error: "Unknown message type" });
    }

    // Serialize async authentication and subscription messages on this connection.
    let pending = Promise.resolve();
    ws.on("message", (data) => {
      pending = pending
        .then(() => handleMessage(data))
        .catch((error) => {
          console.error("WebSocket message error:", error.message);
          send(ws, { type: "error", error: "Internal server error" });
        });
    });
  });

  return wss;
}

module.exports = attachTaskWebSocket;
