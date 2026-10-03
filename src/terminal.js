import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { createConnection } from "./connection.js";
import { setupTouchGestures } from "./touch-gestures.js";
import { setupMobileInput } from "./mobile-input.js";

const THEME = {
  background: "#101b2c",
  foreground: "#c9d1d9",
  cursor: "#58a6ff",
  cursorAccent: "#101b2c",
  selectionBackground: "rgba(31, 111, 235, 0.3)",
  black: "#101b2c",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d353",
  white: "#c9d1d9",
  brightBlack: "#484f58",
  brightRed: "#ff7b72",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d364",
  brightWhite: "#f0f6fc",
};

const NOTICES = {
  reconnecting: "\r\n\x1b[1;33m[Reconnecting...]\x1b[0m\r\n",
  taken: "\r\n\x1b[1;33m[Session taken by another connection]\x1b[0m\r\n",
};

function buildWsUrl(session) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws?session=${encodeURIComponent(session || "")}`;
}

export function createTerminal(
  container,
  { session, fontSize = 14, onDataTransform, beforeReconnect },
) {
  const term = new Terminal({
    fontSize,
    fontFamily:
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    theme: THEME,
    scrollback: 5000,
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();
  const searchAddon = new SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.loadAddon(searchAddon);

  term.open(container);

  // Force mobile keyboard to lowercase mode
  const helperTextarea = container.querySelector(".xterm-helper-textarea");
  if (helperTextarea) {
    helperTextarea.setAttribute("autocapitalize", "none");
  }

  const mobileInput = setupMobileInput(term);

  requestAnimationFrame(() => fitAddon.fit());

  // --- WebSocket with auto-reconnect ---
  const connection = createConnection({
    session,
    buildUrl: buildWsUrl,
    getSize: () => ({ cols: term.cols, rows: term.rows }),
    onOutput: (data) => term.write(data),
    onNotice: (kind) => term.write(NOTICES[kind]),
    beforeReconnect,
  });
  connection.connect();

  function onVisibilityChange() {
    if (document.visibilityState === "visible") connection.checkAlive();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Control input (Enter, Tab, arrows…) ends the current word/line, so put
  // the keyboard back into lowercase mid-sentence context
  const CONTROL_INPUT_RE = /[\x00-\x1f]/;

  term.onData((data) => {
    connection.send(onDataTransform ? onDataTransform(data) : data);
    if (CONTROL_INPUT_RE.test(data)) mobileInput.resetContext();
  });

  // --- Resize handling ---
  let fitTimer = null;
  let lastCols = term.cols;
  let lastRows = term.rows;

  function debouncedFit() {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      fitTimer = null;
      const dims = fitAddon.proposeDimensions();
      if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
        lastCols = dims.cols;
        lastRows = dims.rows;
        fitAddon.fit();
      }
    }, 150);
  }

  const resizeObserver = new ResizeObserver(() => debouncedFit());
  resizeObserver.observe(container);

  term.onResize(({ cols, rows }) => {
    connection.sendJson({ type: "resize", cols, rows });
  });

  // --- Touch gestures ---
  const sendKeys = (seq) => {
    connection.send(seq);
    mobileInput.resetContext();
  };
  setupTouchGestures(container, term, sendKeys);

  function setFontSize(size) {
    // xterm API requires direct property mutation
    term.options.fontSize = size;
    lastCols = 0;
    lastRows = 0;
    fitAddon.fit();
  }

  function dispose() {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    resizeObserver.disconnect();
    connection.dispose();
    term.dispose();
  }

  return {
    term,
    searchAddon,
    setFontSize,
    sendKeys,
    switchWindow: (targetSession, windowIndex) =>
      connection.switchSession(targetSession, windowIndex),
    newWindow: (targetSession) =>
      connection.sendJson({ type: "new-window", session: targetSession }),
    newSession: (name) => connection.sendJson({ type: "new-session", name }),
    killSession: (name) => connection.sendJson({ type: "kill-session", name }),
    killWindow: (sessionName, windowIndex) =>
      connection.sendJson({
        type: "kill-window",
        session: sessionName,
        window: windowIndex,
      }),
    dispose,
    fit: debouncedFit,
  };
}
