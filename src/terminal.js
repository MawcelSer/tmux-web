import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

/**
 * Initialize xterm.js terminal and wire it to a WebSocket.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.session - tmux session name
 * @param {number} opts.fontSize
 * @param {(session: string, windowIndex: number) => void} opts.onSwitch
 * @returns {{ term, ws, fitAddon, setFontSize, dispose }}
 */
export function createTerminal(container, { session, fontSize = 14 }) {
  const term = new Terminal({
    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    theme: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#e94560',
      cursorAccent: '#1a1a2e',
      selectionBackground: 'rgba(83, 52, 131, 0.5)',
      black: '#1a1a2e',
      red: '#e94560',
      green: '#2ecc71',
      yellow: '#f1c40f',
      blue: '#3498db',
      magenta: '#9b59b6',
      cyan: '#1abc9c',
      white: '#e0e0e0',
      brightBlack: '#555577',
      brightRed: '#ff6b81',
      brightGreen: '#44d68f',
      brightYellow: '#f9e154',
      brightBlue: '#5dade2',
      brightMagenta: '#bb8fce',
      brightCyan: '#48c9b0',
      brightWhite: '#ffffff',
    },
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

  // Delay fit to ensure container is sized
  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  // Connect WebSocket
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws?session=${encodeURIComponent(session || '')}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    // Send initial size
    ws.send(JSON.stringify({
      type: 'resize',
      cols: term.cols,
      rows: term.rows,
    }));
  });

  ws.addEventListener('message', (event) => {
    const data = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : event.data;
    term.write(data);
  });

  ws.addEventListener('close', () => {
    term.write('\r\n\x1b[1;31m[Connection closed]\x1b[0m\r\n');
  });

  // Forward terminal input to WebSocket
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
  });
  resizeObserver.observe(container);

  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  function setFontSize(size) {
    term.options.fontSize = size;
    fitAddon.fit();
  }

  function sendKeys(seq) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(seq);
    }
  }

  function switchWindow(targetSession, windowIndex) {
    const cmd = `tmux switch-client -t ${targetSession}:${windowIndex}\n`;
    sendKeys(cmd);
  }

  function dispose() {
    resizeObserver.disconnect();
    ws.close();
    term.dispose();
  }

  return { term, ws, fitAddon, searchAddon, setFontSize, sendKeys, switchWindow, dispose };
}
