import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { WebSocketServer } from "ws";
import { execFile } from "node:child_process";
import { createPty as defaultCreatePty } from "./pty-manager.js";
import {
  listSessions as defaultListSessions,
  listWindows as defaultListWindows,
} from "./tmux-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "dist");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

const VALID_NAME_RE = /^[\w\-. ]+$/;
const MAX_SEND_BUF_BYTES = 1024 * 1024; // 1 MB cap to prevent OOM
const MAX_INPUT_BYTES = 65536; // 64 KB cap on incoming terminal input
const CLOSE_TIMEOUT_MS = 5000;

function isValidName(name) {
  return (
    typeof name === "string" && name.length > 0 && VALID_NAME_RE.test(name)
  );
}

function isValidWindowIndex(idx) {
  return Number.isInteger(idx) && idx >= 0;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function tmuxExec(args) {
  execFile("tmux", args, (err) => {
    if (err) console.error("tmux command failed:", args[0], err.message);
  });
}

/**
 * Create and return the HTTP + WebSocket server.
 * All dependencies are injectable for testing.
 */
export function createServer({
  port = 3000,
  listSessionsFn = defaultListSessions,
  listWindowsFn = defaultListWindows,
  createPtyFn = defaultCreatePty,
} = {}) {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // REST API — GET only
    if (pathname === "/api/sessions") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method Not Allowed" });
        return;
      }
      const sessions = await listSessionsFn();
      sendJson(res, 200, { sessions });
      return;
    }

    const windowsMatch = pathname.match(/^\/api\/windows\/(.+)$/);
    if (windowsMatch) {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method Not Allowed" });
        return;
      }
      const session = decodeURIComponent(windowsMatch[1]);
      try {
        const windows = await listWindowsFn(session);
        sendJson(res, 200, { windows });
      } catch {
        sendJson(res, 404, { error: "Session not found" });
      }
      return;
    }

    // Static files from dist/
    let filePath = pathname === "/" ? "/index.html" : pathname;
    const fullPath = resolve(join(DIST_DIR, filePath));

    // Prevent path traversal
    if (!fullPath.startsWith(DIST_DIR + "/") && fullPath !== DIST_DIR) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    try {
      const content = await readFile(fullPath);
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
    } catch {
      sendJson(res, 404, { error: "Not found" });
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const activeSessions = new Map();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const session = url.searchParams.get("session") || "";

    // Kill old PTY bridge for the same session to prevent duplicate clients
    if (session && activeSessions.has(session)) {
      const old = activeSessions.get(session);
      old.pty.kill();
      if (old.ws.readyState <= 1)
        old.ws.close(1000, "Replaced by new connection");
      activeSessions.delete(session);
    }

    const pty = createPtyFn({
      session,
      cols: 80,
      rows: 24,
    });

    if (session) activeSessions.set(session, { ws, pty });

    // Coalesce PTY output using setImmediate with a byte cap to prevent OOM.
    // Batches data from the same event loop tick into one WebSocket send.
    let sendBuf = [];
    let sendBufBytes = 0;
    let sendScheduled = false;

    function flushSendBuf() {
      sendScheduled = false;
      if (sendBuf.length && ws.readyState === 1) {
        ws.send(Buffer.concat(sendBuf));
        sendBuf = [];
        sendBufBytes = 0;
      }
    }

    pty.onData((data) => {
      if (ws.readyState !== 1) return;
      sendBuf.push(data);
      sendBufBytes += data.length;
      if (sendBufBytes > MAX_SEND_BUF_BYTES) {
        console.error("Output buffer overflow for session:", session);
        sendBuf = [];
        sendBufBytes = 0;
        if (ws.readyState === 1) {
          ws.close(1011, "Output buffer overflow");
        }
        return;
      }
      if (!sendScheduled) {
        sendScheduled = true;
        setImmediate(flushSendBuf);
      }
    });

    pty.onExit(() => {
      if (ws.readyState === 1) {
        ws.close(1000, "PTY exited");
      }
    });

    ws.on("message", (msg) => {
      const str = msg.toString();
      // Fast path: only attempt JSON parse if message looks like JSON object
      if (str.charCodeAt(0) === 123) {
        // '{'
        try {
          const parsed = JSON.parse(str);
          if (parsed.type === "resize") {
            const { cols, rows } = parsed;
            if (
              Number.isInteger(cols) &&
              Number.isInteger(rows) &&
              cols > 0 &&
              cols <= 500 &&
              rows > 0 &&
              rows <= 200
            ) {
              pty.resize(cols, rows);
            }
            return;
          }
          if (parsed.type === "switch") {
            if (!isValidName(parsed.session)) return;
            if (parsed.window != null && !isValidWindowIndex(parsed.window))
              return;
            const tty = pty.getTty();
            if (!tty) {
              console.error(
                "switch-client skipped: PTY tty not yet available for session:",
                session,
              );
              return;
            }
            const target =
              parsed.window != null
                ? `${parsed.session}:${parsed.window}`
                : parsed.session;
            tmuxExec(["switch-client", "-c", tty, "-t", target]);
            return;
          }
          if (parsed.type === "new-window") {
            if (!isValidName(parsed.session)) return;
            tmuxExec(["new-window", "-t", parsed.session]);
            return;
          }
          if (parsed.type === "new-session") {
            if (!isValidName(parsed.name)) return;
            tmuxExec(["new-session", "-d", "-s", parsed.name]);
            return;
          }
          if (parsed.type === "kill-session") {
            if (!isValidName(parsed.name)) return;
            tmuxExec(["kill-session", "-t", parsed.name]);
            return;
          }
          if (parsed.type === "kill-window") {
            if (!isValidName(parsed.session)) return;
            if (!isValidWindowIndex(parsed.window)) return;
            tmuxExec([
              "kill-window",
              "-t",
              `${parsed.session}:${parsed.window}`,
            ]);
            return;
          }
          // Any JSON with a 'type' field is a control message — never forward to terminal
          if (parsed.type) return;
        } catch {
          // Malformed JSON, fall through to treat as terminal input
        }
      }
      if (str.length > MAX_INPUT_BYTES) return;
      pty.write(str);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error for session:", session, err.message);
    });

    ws.on("close", () => {
      sendBuf = [];
      sendBufBytes = 0;
      pty.kill();
      if (session && activeSessions.get(session)?.ws === ws) {
        activeSessions.delete(session);
      }
    });
  });

  httpServer.listen(port);

  return {
    httpServer,
    wss,
    close() {
      return new Promise((resolve) => {
        const timeout = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        wss.clients.forEach((ws) => ws.terminate());
        wss.close(() => {
          httpServer.close(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
      });
    },
  };
}
