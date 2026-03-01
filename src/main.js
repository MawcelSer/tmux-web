import '@xterm/xterm/css/xterm.css';
import { createTerminal } from './terminal.js';
import { createToolbar } from './toolbar.js';
import { FontSizeManager } from './font-size.js';
import { createSessionSwitcher } from './session-switcher.js';

const urlParams = new URLSearchParams(location.search);
const initialSession = urlParams.get('session') || '';

const fontMgr = new FontSizeManager();

const termContainer = document.getElementById('terminal-container');
const terminal = createTerminal(termContainer, {
  session: initialSession,
  fontSize: fontMgr.get(),
});

fontMgr.onChange((size) => terminal.setFontSize(size));

createToolbar(document.getElementById('toolbar-container'), {
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
});

if (initialSession) {
  switcher.setCurrentSession(initialSession);
}

// Fetch session list on startup for swipe navigation
refreshSessionList();

// --- Tap terminal = close switcher panel + focus ---
termContainer.addEventListener('click', () => {
  switcher.hide();
  terminal.term.focus();
});

// --- Swipe to switch sessions ---
termContainer.addEventListener('swipe-session', async (e) => {
  // Refresh list to catch new sessions
  await refreshSessionList();
  if (sessionList.length < 2) return;

  // Find current index
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
    terminal.fitAddon.fit();
  };
  window.visualViewport.addEventListener('resize', onViewportResize);
  window.visualViewport.addEventListener('scroll', onViewportResize);
}
