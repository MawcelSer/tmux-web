import http from "node:http";
import { WebSocketServer } from "ws";
import { createPty as defaultCreatePty } from "./pty-manager.js";
import {
  listSessions as defaultListSessions,
  listWindows as defaultListWindows,
  runTmux as defaultRunTmux,
} from "./tmux-api.js";
import { createHttpHandler, URL_BASE } from "./http-routes.js";
import {
  isValidName,
  isValidWindowIndex,
  isValidSize,
  isAllowedOrigin,
} from "./validation.js";

const MAX_SEND_BUF_BYTES = 1024 * 1024; // 1 MB cap to prevent OOM
const MAX_INPUT_BYTES = 65536; // 64 KB cap on incoming terminal input
const MAX_PAYLOAD_BYTES = 1024 * 1024; // frames above this close with 1009
const CLOSE_TIMEOUT_MS = 5000;
const DEFAULT_HEARTBEAT_MS = 30000;
// tmux registers the client a few ms after `tmux attach` starts, and the
// bridge reports its tty asynchronously — retry instead of dropping switches.
const SWITCH_RETRY_MS = 100;
const SWITCH_MAX_ATTEMPTS = 10;
const CLIENT_NOT_READY_RE = /can't find client/i;

export const REPLACED_REASON = "Replaced by new connection";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Create and return the HTTP + WebSocket server.
 * All dependencies are injectable for testing.
 */
export function createServer({
  port = 3000,
  listSessionsFn = defaultListSessions,
  listWindowsFn = defaultListWindows,
  createPtyFn = defaultCreatePty,
  tmuxExecFn = defaultRunTmux,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  allowedOrigins = [],
} = {}) {
  const httpServer = http.createServer(
    createHttpHandler({ listSessionsFn, listWindowsFn }),
  );

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    maxPayload: MAX_PAYLOAD_BYTES,
    verifyClient: ({ origin, req }, done) => {
      if (isAllowedOrigin(origin, req, allowedOrigins)) {
        done(true);
        return;
      }
      console.error("Rejected WebSocket from origin:", origin);
      done(false, 403, "Forbidden");
    },
  });

  // Dedup map: session name → the connection currently showing it.
  // Used to kill stale bridges when the same client reconnects.
  const activeSessions = new Map();

  function tmux(args) {
    return tmuxExecFn(args).catch((err) => {
      console.error("tmux command failed:", args[0], err.message);
    });
  }

  async function switchClient(conn, target) {
    for (let attempt = 1; attempt <= SWITCH_MAX_ATTEMPTS; attempt++) {
      if (conn.closed) return false;
      const tty = conn.pty.getTty?.();
      if (tty) {
        try {
          await tmuxExecFn(["switch-client", "-c", tty, "-t", target]);
          return true;
        } catch (err) {
          // Only an unregistered client is transient; a missing target is not
          if (!CLIENT_NOT_READY_RE.test(err.message)) {
            console.error("switch-client failed:", target, err.message);
            return false;
          }
          if (attempt === SWITCH_MAX_ATTEMPTS) {
            console.error("switch-client failed:", target, err.message);
            return false;
          }
        }
      }
      await delay(SWITCH_RETRY_MS);
    }
    console.error("switch-client skipped: PTY tty never became available");
    return false;
  }

  function claimSession(conn, session) {
    if (conn.session && activeSessions.get(conn.session) === conn) {
      activeSessions.delete(conn.session);
    }
    conn.session = session;
    if (session && !activeSessions.has(session)) {
      activeSessions.set(session, conn);
    }
  }

  function handleControl(conn, msg) {
    switch (msg.type) {
      case "ping":
        conn.ws.send(JSON.stringify({ type: "pong" }));
        return;
      case "resize":
        if (isValidSize(msg.cols, msg.rows))
          conn.pty.resize(msg.cols, msg.rows);
        return;
      case "switch": {
        if (!isValidName(msg.session)) return;
        if (msg.window != null && !isValidWindowIndex(msg.window)) return;
        const target =
          msg.window != null ? `${msg.session}:${msg.window}` : msg.session;
        // Serialize so rapid switches land in order despite retries
        conn.switchQueue = conn.switchQueue
          .then(() => switchClient(conn, target))
          .then((ok) => {
            if (ok && !conn.closed) claimSession(conn, msg.session);
          });
        return;
      }
      case "new-window":
        if (isValidName(msg.session)) tmux(["new-window", "-t", msg.session]);
        return;
      case "new-session":
        if (isValidName(msg.name)) tmux(["new-session", "-d", "-s", msg.name]);
        return;
      case "kill-session":
        if (isValidName(msg.name)) tmux(["kill-session", "-t", msg.name]);
        return;
      case "kill-window":
        if (isValidName(msg.session) && isValidWindowIndex(msg.window)) {
          tmux(["kill-window", "-t", `${msg.session}:${msg.window}`]);
        }
        return;
      default:
      // Unknown control types are ignored — never forwarded to the terminal
    }
  }

  function parseControl(str) {
    // Fast path: only attempt JSON parse if message looks like a JSON object
    if (str.charCodeAt(0) !== 123) return null;
    try {
      const parsed = JSON.parse(str);
      return parsed && parsed.type ? parsed : null;
    } catch {
      return null; // Malformed JSON — treat as terminal input
    }
  }

  function pipePtyOutput(conn) {
    const { ws, pty } = conn;
    // Coalesce PTY output from the same event loop tick into one send
    let sendBuf = [];
    let sendBufBytes = 0;
    let sendScheduled = false;

    function flushSendBuf() {
      sendScheduled = false;
      if (sendBuf.length && ws.readyState === 1) {
        ws.send(Buffer.concat(sendBuf));
      }
      sendBuf = [];
      sendBufBytes = 0;
    }

    pty.onData((data) => {
      if (ws.readyState !== 1) return;
      sendBuf.push(data);
      sendBufBytes += data.length;
      if (sendBufBytes > MAX_SEND_BUF_BYTES) {
        console.error("Output buffer overflow for session:", conn.session);
        sendBuf = [];
        sendBufBytes = 0;
        ws.close(1011, "Output buffer overflow");
        return;
      }
      if (!sendScheduled) {
        sendScheduled = true;
        setImmediate(flushSendBuf);
      }
    });
  }

  // Heartbeat: half-dead mobile sockets never fire 'close' on their own.
  // Their tmux clients linger and pin the window to a stale size.
  const awaitingPong = new Set();
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (awaitingPong.has(client)) {
        client.terminate();
        continue;
      }
      awaitingPong.add(client);
      client.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, URL_BASE);
    const session = url.searchParams.get("session") || "";

    // Kill old PTY bridge for the same session to prevent duplicate clients
    const old = session && activeSessions.get(session);
    if (old) {
      old.closed = true; // stop its pending switch retries right away
      old.pty.kill();
      if (old.ws.readyState <= 1) old.ws.close(1000, REPLACED_REASON);
      activeSessions.delete(session);
    }

    const pty = createPtyFn({ session, cols: 80, rows: 24 });
    const conn = {
      ws,
      pty,
      session: "",
      closed: false,
      switchQueue: Promise.resolve(),
    };
    claimSession(conn, session);
    pipePtyOutput(conn);

    pty.onExit(() => {
      if (ws.readyState === 1) ws.close(1000, "PTY exited");
    });

    ws.on("pong", () => awaitingPong.delete(ws));

    ws.on("message", (msg) => {
      const str = msg.toString();
      const control = parseControl(str);
      if (control) {
        handleControl(conn, control);
        return;
      }
      if (str.length > MAX_INPUT_BYTES) return;
      pty.write(str);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error for session:", conn.session, err.message);
    });

    ws.on("close", () => {
      conn.closed = true;
      awaitingPong.delete(ws);
      pty.kill();
      if (conn.session && activeSessions.get(conn.session) === conn) {
        activeSessions.delete(conn.session);
      }
    });
  });

  httpServer.listen(port);

  return {
    httpServer,
    wss,
    close() {
      clearInterval(heartbeat);
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
