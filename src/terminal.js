import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

/**
 * Initialize xterm.js terminal and wire it to a WebSocket.
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

  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  // Connect WebSocket
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws?session=${encodeURIComponent(session || '')}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
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

  // --- Touch scroll → mouse wheel events for tmux ---
  // When tmux has `set -g mouse on`, it expects mouse wheel escape sequences
  // to enter/exit copy (scroll) mode. On mobile, touch events don't produce
  // wheel events, so we convert touch drag → SGR mouse wheel sequences.
  {
    let touchStartY = null;
    let scrollAccumulator = 0;
    const PX_PER_LINE = 24;
    const MAX_LINES_PER_FRAME = 5;

    // Attach to the xterm screen element once it exists
    const attachTouchScroll = () => {
      const screen = container.querySelector('.xterm-screen');
      if (!screen) return;

      screen.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          touchStartY = e.touches[0].clientY;
          scrollAccumulator = 0;
        }
      }, { passive: true });

      screen.addEventListener('touchmove', (e) => {
        if (touchStartY === null || e.touches.length !== 1) return;

        const currentY = e.touches[0].clientY;
        const delta = touchStartY - currentY; // positive = finger moved up = scroll up
        touchStartY = currentY;

        // Ignore tiny movements (taps)
        if (Math.abs(delta) < 2) return;

        scrollAccumulator += delta;

        const lines = Math.trunc(scrollAccumulator / PX_PER_LINE);
        if (lines !== 0) {
          scrollAccumulator -= lines * PX_PER_LINE;
          // SGR mouse encoding: \x1b[<button;col;rowM
          // button 64 = wheel up, 65 = wheel down
          const button = lines > 0 ? 64 : 65;
          const count = Math.min(Math.abs(lines), MAX_LINES_PER_FRAME);
          const seq = `\x1b[<${button};1;1M`;
          for (let i = 0; i < count; i++) {
            sendKeys(seq);
          }
        }

        e.preventDefault();
      }, { passive: false });

      screen.addEventListener('touchend', () => {
        touchStartY = null;
        scrollAccumulator = 0;
      }, { passive: true });
    };

    // xterm-screen may not exist immediately, wait a frame
    requestAnimationFrame(attachTouchScroll);
  }

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
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'switch',
        session: targetSession,
        window: windowIndex,
      }));
    }
  }

  function dispose() {
    resizeObserver.disconnect();
    ws.close();
    term.dispose();
  }

  return { term, ws, fitAddon, searchAddon, setFontSize, sendKeys, switchWindow, dispose };
}
