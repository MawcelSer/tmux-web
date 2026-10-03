/**
 * WebSocket connection to the tmux bridge with auto-reconnect,
 * liveness checks and queued session switches.
 */

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const PONG_TIMEOUT_MS = 3000;
// A hung session lookup must never block reconnecting
const BEFORE_RECONNECT_TIMEOUT_MS = 3000;
// Backoff only resets once a connection has stayed up this long, so an
// open-then-immediately-close loop (e.g. no tmux sessions) keeps backing off
const STABLE_CONNECTION_MS = 5000;
const REPLACED_REASON = "Replaced by new connection";

/**
 * @param {object} opts
 * @param {string} opts.session - initial tmux session ("" = most recent)
 * @param {(session: string) => string} opts.buildUrl
 * @param {() => {cols: number, rows: number}} opts.getSize
 * @param {(data: Uint8Array) => void} opts.onOutput - terminal output
 * @param {(kind: "reconnecting" | "taken") => void} opts.onNotice
 * @param {() => Promise<void>} [opts.beforeReconnect] - runs before every
 *   reconnect; may call switchSession() to redirect a dead session
 * @param {typeof WebSocket} [opts.WebSocketImpl]
 */
export function createConnection({
  session = "",
  buildUrl,
  getSize,
  onOutput,
  onNotice,
  beforeReconnect,
  WebSocketImpl = globalThis.WebSocket,
}) {
  const { OPEN, CONNECTING } = WebSocketImpl;
  let ws = null;
  let currentSession = session;
  let pendingSwitch = null;
  let reconnectTimer = null;
  let reconnectDelay = INITIAL_RECONNECT_DELAY;
  let reconnecting = false;
  let pongTimer = null;
  let stableTimer = null;
  // Set when another connection took over this session; only an explicit
  // switchSession() reclaims it, so two devices don't fight on tab focus
  let taken = false;
  let disposed = false;

  function send(data) {
    if (ws && ws.readyState === OPEN) {
      ws.send(data);
      return true;
    }
    return false;
  }

  function sendJson(msg) {
    return send(JSON.stringify(msg));
  }

  function clearReconnectTimer() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearPongTimer() {
    clearTimeout(pongTimer);
    pongTimer = null;
  }

  function clearStableTimer() {
    clearTimeout(stableTimer);
    stableTimer = null;
  }

  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function handleControl(text) {
    try {
      if (JSON.parse(text).type === "pong") clearPongTimer();
    } catch (err) {
      console.error("Ignoring malformed control frame:", err);
    }
  }

  function connect() {
    clearReconnectTimer();
    clearPongTimer();
    clearStableTimer();
    taken = false;
    const previous = ws;
    const socket = new WebSocketImpl(buildUrl(currentSession));
    socket.binaryType = "arraybuffer";
    ws = socket;
    // Close after reassigning `ws` so the old socket's close event is ignored
    if (previous && previous.readyState <= OPEN) previous.close();

    // Every handler checks `socket !== ws`: events from replaced sockets
    // must not write output, show notices or schedule more reconnects.
    socket.addEventListener("open", () => {
      if (socket !== ws) return;
      stableTimer = setTimeout(() => {
        reconnectDelay = INITIAL_RECONNECT_DELAY;
      }, STABLE_CONNECTION_MS);
      sendJson({ type: "resize", ...getSize() });
      if (pendingSwitch) {
        sendJson(pendingSwitch);
        pendingSwitch = null;
      }
    });

    socket.addEventListener("message", (event) => {
      if (socket !== ws) return;
      if (typeof event.data === "string") {
        handleControl(event.data);
        return;
      }
      onOutput(new Uint8Array(event.data));
    });

    socket.addEventListener("close", (event) => {
      if (socket !== ws || disposed) return;
      clearPongTimer();
      clearStableTimer();
      if (event.code === 1000 && event.reason === REPLACED_REASON) {
        taken = true;
        onNotice("taken");
        return;
      }
      onNotice("reconnecting");
      scheduleReconnect();
    });
  }

  async function reconnect() {
    if (reconnecting) return;
    reconnecting = true;
    try {
      if (beforeReconnect) {
        await withTimeout(beforeReconnect(), BEFORE_RECONNECT_TIMEOUT_MS);
      }
    } catch (err) {
      console.error("beforeReconnect failed:", err);
    } finally {
      reconnecting = false;
    }
    if (!disposed) connect();
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const wait = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnect();
    }, wait);
  }

  function reconnectNow() {
    clearReconnectTimer();
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    reconnect();
  }

  /** Verify the socket is really alive (mobile sockets die silently). */
  function checkAlive() {
    if (disposed || taken || !ws || ws.readyState === CONNECTING) return;
    if (ws.readyState !== OPEN) {
      reconnectNow();
      return;
    }
    if (pongTimer) return;
    sendJson({ type: "ping" });
    pongTimer = setTimeout(() => {
      pongTimer = null;
      onNotice("reconnecting");
      reconnectNow();
    }, PONG_TIMEOUT_MS);
  }

  /** Switch the attached client; queued until the socket is open. */
  function switchSession(targetSession, windowIndex) {
    currentSession = targetSession;
    const msg = { type: "switch", session: targetSession, window: windowIndex };
    pendingSwitch = sendJson(msg) ? null : msg;
    if (taken) reconnectNow(); // explicit user choice reclaims the session
  }

  function dispose() {
    disposed = true;
    clearReconnectTimer();
    clearPongTimer();
    clearStableTimer();
    if (ws) ws.close();
  }

  return {
    connect,
    send,
    sendJson,
    switchSession,
    checkAlive,
    dispose,
    getSession: () => currentSession,
  };
}
