import { createServer } from "./ws-server.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

// Extra allowed WebSocket origins, comma-separated — needed when the app is
// reached through a proxy that rewrites Host (e.g. https://box.tailnet.ts.net)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const server = createServer({ port: PORT, allowedOrigins: ALLOWED_ORIGINS });

server.httpServer.on("listening", () => {
  const addr = server.httpServer.address();
  console.info(`TmuxWeb server listening on http://localhost:${addr.port}`);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

function shutdown() {
  console.info("Shutting down...");
  server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
