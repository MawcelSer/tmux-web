import '@xterm/xterm/css/xterm.css';
import { createTerminal } from './terminal.js';
import { createToolbar } from './toolbar.js';
import { FontSizeManager } from './font-size.js';
import { createSessionSwitcher } from './session-switcher.js';

// Determine initial session from URL hash or default
const urlParams = new URLSearchParams(location.search);
const initialSession = urlParams.get('session') || '';

// Font size manager
const fontMgr = new FontSizeManager();

// Create terminal
const termContainer = document.getElementById('terminal-container');
const terminal = createTerminal(termContainer, {
  session: initialSession,
  fontSize: fontMgr.get(),
});

// Font size → terminal sync
fontMgr.onChange((size) => terminal.setFontSize(size));

// Toolbar
createToolbar(document.getElementById('toolbar-container'), {
  onKey: (seq) => terminal.sendKeys(seq),
  onIncrease: () => fontMgr.increase(),
  onDecrease: () => fontMgr.decrease(),
});

// Session/Window switcher
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
  },
  onNewWindow: (session) => {
    // tmux prefix + c = new window in current session
    terminal.sendKeys('\x02c');
  },
});

if (initialSession) {
  switcher.setCurrentSession(initialSession);
}

// Focus terminal on tap (helps mobile keyboards)
termContainer.addEventListener('click', () => {
  terminal.term.focus();
});

// --- Virtual keyboard viewport fix ---
// Use visualViewport API to shrink the layout when the mobile keyboard opens,
// so the terminal + toolbar stay above the keyboard instead of being covered.
if (window.visualViewport) {
  const onViewportResize = () => {
    const vv = window.visualViewport;
    // Height difference = keyboard height
    const keyboardOffset = window.innerHeight - vv.height;
    document.body.style.height = `${vv.height}px`;
    // Scroll the viewport to compensate for any offset
    document.body.style.transform = `translateY(${vv.offsetTop}px)`;
    // Re-fit terminal to the new size
    terminal.fitAddon.fit();
  };
  window.visualViewport.addEventListener('resize', onViewportResize);
  window.visualViewport.addEventListener('scroll', onViewportResize);
}
