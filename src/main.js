import '@xterm/xterm/css/xterm.css';
import { createTerminal } from './terminal.js';
import { createToolbar } from './toolbar.js';
import { FontSizeManager } from './font-size.js';
import { createSessionSwitcher } from './session-switcher.js';

const urlParams = new URLSearchParams(location.search);
const initialSession = urlParams.get('session') || '';

const fontMgr = new FontSizeManager();

const termContainer = document.getElementById('terminal-container');

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
});

fontMgr.onChange((size) => terminal.setFontSize(size));

toolbar = createToolbar(document.getElementById('toolbar-container'), {
  onKey: (seq) => terminal.sendKeys(seq),
  onIncrease: () => fontMgr.increase(),
  onDecrease: () => fontMgr.decrease(),
});

// Session list cache for swipe navigation
let sessionList = [];
let currentSessionIndex = -1;

async function refreshSessionList() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    sessionList = data.sessions.map((s) => s.name);
    if (switcher._currentSession) {
      currentSessionIndex = sessionList.indexOf(switcher._currentSession);
    } else if (data.sessions.length > 0) {
      // No session selected yet — pick attached session or first available
      const attached = data.sessions.find((s) => s.attached);
      const target = attached ? attached.name : data.sessions[0].name;
      switcher.setCurrentSession(target);
      currentSessionIndex = sessionList.indexOf(target);
    }
  } catch { /* ignore */ }
}

const switcher = createSessionSwitcher({
  panel: document.getElementById('switcher-panel'),
  list: document.getElementById('switcher-list'),
  title: document.getElementById('switcher-title'),
  closeBtn: document.getElementById('switcher-close'),
  sessionsBtn: document.getElementById('btn-sessions'),
  windowsBtn: document.getElementById('btn-windows'),
  currentLabel: document.getElementById('current-session'),
  onSwitch: (session, windowIndex) => {
    terminal.switchWindow(session, windowIndex);
    switcher.setCurrentSession(session);
    currentSessionIndex = sessionList.indexOf(session);
  },
  onNewWindow: (session) => {
    terminal.newWindow(session);
  },
  onNewSession: (name) => {
    terminal.newSession(name);
    setTimeout(async () => {
      await refreshSessionList();
      if (sessionList.includes(name)) {
        terminal.switchWindow(name, null);
        switcher.setCurrentSession(name);
        currentSessionIndex = sessionList.indexOf(name);
      }
    }, 300);
  },
  onKillSession: (name, isCurrentSession) => {
    terminal.killSession(name);
    if (isCurrentSession) {
      setTimeout(async () => {
        await refreshSessionList();
        if (sessionList.length > 0) {
          const target = sessionList[0];
          terminal.switchWindow(target, null);
          switcher.setCurrentSession(target);
          currentSessionIndex = 0;
        }
      }, 300);
    }
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
termContainer.addEventListener('click', () => {
  switcher.hide();
  terminal.term.focus();
});

// --- Swipe to switch sessions ---
termContainer.addEventListener('swipe-session', async (e) => {
  await refreshSessionList();
  if (sessionList.length < 2) return;

  let idx = currentSessionIndex;
  if (idx < 0) idx = 0;

  if (e.detail.direction === 'next') {
    idx = (idx + 1) % sessionList.length;
  } else {
    idx = (idx - 1 + sessionList.length) % sessionList.length;
  }

  const target = sessionList[idx];
  terminal.switchWindow(target, null);
  switcher.setCurrentSession(target);
  currentSessionIndex = idx;
});

// --- Pinch zoom → font size ---
termContainer.addEventListener('pinch-zoom', (e) => {
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
  window.visualViewport.addEventListener('resize', onViewportResize);
  window.visualViewport.addEventListener('scroll', onViewportResize);
}

/** Apply CTRL/ALT modifiers to terminal input. */
function applyModifiers(data, ctrl, alt) {
  let result = data;
  if (ctrl && data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 97 && code <= 122) result = String.fromCharCode(code - 96);       // a-z
    else if (code >= 65 && code <= 90) result = String.fromCharCode(code - 64);    // A-Z
    else if (code >= 91 && code <= 95) result = String.fromCharCode(code - 64);    // [\]^_
    else if (code === 32) result = '\x00';                                          // space
  }
  if (alt) {
    result = '\x1b' + result;
  }
  return result;
}
