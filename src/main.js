import "@xterm/xterm/css/xterm.css";
import { createTerminal } from "./terminal.js";
import { createToolbar } from "./toolbar.js";
import { FontSizeManager } from "./font-size.js";
import { createSessionSwitcher } from "./session-switcher.js";
import { pickSession } from "./session-picker.js";

const LAST_SESSION_KEY = "tmuxweb:lastSession";
const urlParams = new URLSearchParams(location.search);
const initialSession =
  urlParams.get("session") || localStorage.getItem(LAST_SESSION_KEY) || "";

const fontMgr = new FontSizeManager();

const termContainer = document.getElementById("terminal-container");

// Toolbar ref (assigned after createToolbar, used lazily in onDataTransform)
let toolbar;

const terminal = createTerminal(termContainer, {
  session: initialSession,
  fontSize: fontMgr.get(),
  onDataTransform: (data) => {
    if (!toolbar) return data;
    const { ctrl, alt } = toolbar.getModifiers();
    if (!ctrl && !alt) return data;
    toolbar.clearModifiers();
    return applyModifiers(data, ctrl, alt);
  },
  // Re-validate the session before every reconnect so a killed/exited
  // session falls back to a live one instead of reconnecting forever.
  beforeReconnect: refreshSessionList,
});

fontMgr.onChange((size) => terminal.setFontSize(size));

toolbar = createToolbar(document.getElementById("toolbar-container"), {
  onKey: (seq) => terminal.sendKeys(seq),
  onIncrease: () => fontMgr.increase(),
  onDecrease: () => fontMgr.decrease(),
});

// Session list cache for swipe navigation
let sessionList = [];

function currentSessionIndex() {
  const current = switcher.getCurrentSession();
  return current ? sessionList.indexOf(current) : -1;
}

function activateSession(name) {
  terminal.switchWindow(name, null);
  switcher.setCurrentSession(name);
  localStorage.setItem(LAST_SESSION_KEY, name);
}

async function refreshSessionList() {
  try {
    const res = await fetch("/api/sessions");
    if (!res.ok) throw new Error(`GET /api/sessions returned ${res.status}`);
    const data = await res.json();
    sessionList = data.sessions.map((s) => s.name);
    // Covers first load, a stale saved session, and the current one dying
    const target = pickSession(data.sessions, switcher.getCurrentSession());
    if (target) activateSession(target);
  } catch (err) {
    console.error("refreshSessionList failed:", err);
  }
}

const switcher = createSessionSwitcher({
  panel: document.getElementById("switcher-panel"),
  list: document.getElementById("switcher-list"),
  title: document.getElementById("switcher-title"),
  closeBtn: document.getElementById("switcher-close"),
  sessionsBtn: document.getElementById("btn-sessions"),
  windowsBtn: document.getElementById("btn-windows"),
  currentLabel: document.getElementById("current-session"),
  onSwitch: (session, windowIndex) => {
    if (windowIndex != null) {
      terminal.switchWindow(session, windowIndex);
      switcher.setCurrentSession(session);
      localStorage.setItem(LAST_SESSION_KEY, session);
    } else {
      activateSession(session);
    }
  },
  onNewWindow: (session) => {
    terminal.newWindow(session);
  },
  onNewSession: (name) => {
    terminal.newSession(name);
    pollUntil(
      () => sessionList.includes(name),
      () => activateSession(name),
    );
  },
  onKillSession: (name, isCurrentSession) => {
    terminal.killSession(name);
    // refreshSessionList() switches away once the session is gone
    if (isCurrentSession) pollUntil(() => !sessionList.includes(name));
  },
  onKillWindow: (session, windowIndex) => {
    terminal.killWindow(session, windowIndex);
  },
});

if (initialSession) {
  switcher.setCurrentSession(initialSession);
}

refreshSessionList();

// --- Tap terminal = close switcher panel + focus ---
termContainer.addEventListener("click", () => {
  switcher.hide();
  terminal.term.focus();
});

// --- Swipe to switch sessions ---
termContainer.addEventListener("swipe-session", async (e) => {
  await refreshSessionList();
  if (sessionList.length < 2) return;

  let idx = currentSessionIndex();
  if (idx < 0) idx = 0;

  if (e.detail.direction === "next") {
    idx = (idx + 1) % sessionList.length;
  } else {
    idx = (idx - 1 + sessionList.length) % sessionList.length;
  }

  activateSession(sessionList[idx]);
});

// --- Pinch zoom → font size ---
termContainer.addEventListener("pinch-zoom", (e) => {
  fontMgr.set(e.detail.fontSize);
});

// --- Virtual keyboard viewport fix ---
if (window.visualViewport) {
  const onViewportResize = () => {
    const vv = window.visualViewport;
    document.body.style.height = `${vv.height}px`;
    document.body.style.transform = `translateY(${vv.offsetTop}px)`;
    terminal.fit();
  };
  window.visualViewport.addEventListener("resize", onViewportResize);
  window.visualViewport.addEventListener("scroll", onViewportResize);
}

/** Retry refreshSessionList until condition is met, then run callback. */
async function pollUntil(
  condition,
  onSuccess = () => {},
  retries = 5,
  delay = 200,
) {
  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, delay));
    await refreshSessionList();
    if (condition()) {
      onSuccess();
      return;
    }
  }
}

/** Apply CTRL/ALT modifiers to terminal input. */
function applyModifiers(data, ctrl, alt) {
  let result = data;
  if (ctrl && data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 97 && code <= 122)
      result = String.fromCharCode(code - 96); // a-z
    else if (code >= 65 && code <= 90)
      result = String.fromCharCode(code - 64); // A-Z
    else if (code >= 91 && code <= 95)
      result = String.fromCharCode(code - 64); // [\]^_
    else if (code === 32) result = "\x00"; // space
  }
  if (alt) {
    result = "\x1b" + result;
  }
  return result;
}
