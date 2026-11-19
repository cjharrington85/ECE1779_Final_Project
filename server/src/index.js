require("dotenv").config();

const http = require("http");
const app = require("./app");
const attachTaskWebSocket = require("./task-websocket");
const startTaskListener = require("./task-listener");

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = attachTaskWebSocket(server);

// Do not accept connections until the database notification listener is ready.
startTaskListener(wss)
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start task listener:", error);
    process.exit(1);
  });
