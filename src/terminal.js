import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { createConnection } from "./connection.js";
import { setupTouchGestures } from "./touch-gestures.js";

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

/**
 * Patch xterm's _handleAnyTextareaChanges to fix SwiftKey double-fire.
 * Tested with @xterm/xterm@5.5.0 — re-verify on every xterm upgrade.
 * See: https://github.com/xtermjs/xterm.js/issues/3600
 *
 * SwiftKey does delete-then-insert for punctuation after auto-space.
 * xterm's _handleAnyTextareaChanges uses newValue.replace(oldValue, '')
 * which fails when delete changes the sequence — replace() returns the
 * ENTIRE textarea as "new" data. Fix: debounce the burst into one diff
 * and use proper prefix/suffix comparison instead of String.replace().
 */
function patchSwiftKeyComposition(term) {
  const core = term._core;
  const compHelper = core?._compositionHelper;

  if (
    !compHelper ||
    typeof compHelper._handleAnyTextareaChanges !== "function" ||
    !("_isComposing" in compHelper) ||
    !("_coreService" in compHelper) ||
    !("_textarea" in compHelper)
  ) {
    return;
  }

  let firstOldValue = null;
  let pendingTimer = null;

  compHelper._handleAnyTextareaChanges = function () {
    if (firstOldValue === null) {
      firstOldValue = this._textarea.value;
    }
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const oldValue = firstOldValue;
      firstOldValue = null;

      if (this._isComposing) return;
      const newValue = this._textarea.value;
      if (newValue === oldValue) return;

      let prefixLen = 0;
      const minLen = Math.min(oldValue.length, newValue.length);
      while (
        prefixLen < minLen &&
        oldValue[prefixLen] === newValue[prefixLen]
      ) {
        prefixLen++;
      }

      let suffixLen = 0;
      while (
        suffixLen < minLen - prefixLen &&
        oldValue[oldValue.length - 1 - suffixLen] ===
          newValue[newValue.length - 1 - suffixLen]
      ) {
        suffixLen++;
      }

      const deleted = oldValue.substring(
        prefixLen,
        oldValue.length - suffixLen,
      );
      const added = newValue.substring(prefixLen, newValue.length - suffixLen);

      for (let k = 0; k < deleted.length; k++) {
        this._coreService.triggerDataEvent("\x7f", true);
      }
      if (added.length > 0) {
        this._dataAlreadySent = added;
        this._coreService.triggerDataEvent(added, true);
      }
    }, 15);
  };
}

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

  patchSwiftKeyComposition(term);

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

  term.onData((data) => {
    connection.send(onDataTransform ? onDataTransform(data) : data);
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
  const sendKeys = (seq) => connection.send(seq);
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
