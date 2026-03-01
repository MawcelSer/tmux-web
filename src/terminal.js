import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

export function createTerminal(container, { session, fontSize = 14 }) {
  const term = new Terminal({
    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: 'rgba(31, 111, 235, 0.3)',
      black: '#0d1117',
      red: '#f85149',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39d353',
      white: '#c9d1d9',
      brightBlack: '#484f58',
      brightRed: '#ff7b72',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d364',
      brightWhite: '#f0f6fc',
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

  // --- Touch gestures ---
  // Handles: 1-finger vertical = scroll, 1-finger horizontal = swipe session,
  //          2-finger pinch = zoom font size
  {
    let touchStartY = null;
    let touchStartX = null;
    let scrollAccumulator = 0;
    let gestureDirection = null; // null | 'scroll' | 'swipe'
    const PX_PER_LINE = 24;
    const MAX_LINES_PER_FRAME = 5;
    const SWIPE_THRESHOLD = 0.4; // 40% of screen width to trigger
    const DIRECTION_LOCK_PX = 10; // pixels to determine scroll vs swipe

    // Pinch zoom state
    let pinchStartDist = null;
    let pinchStartFontSize = null;

    // Swipe arrow elements
    const swipeLeftEl = document.getElementById('swipe-left');
    const swipeRightEl = document.getElementById('swipe-right');

    const attachGestures = () => {
      const screen = container.querySelector('.xterm-screen');
      if (!screen) return;

      screen.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          // Pinch start
          pinchStartDist = getTouchDistance(e.touches);
          pinchStartFontSize = term.options.fontSize;
          touchStartY = null; // cancel scroll
          gestureDirection = null;
          e.preventDefault();
          return;
        }
        if (e.touches.length === 1) {
          touchStartY = e.touches[0].clientY;
          touchStartX = e.touches[0].clientX;
          scrollAccumulator = 0;
          gestureDirection = null;
        }
      }, { passive: false });

      screen.addEventListener('touchmove', (e) => {
        // --- Pinch zoom ---
        if (e.touches.length === 2 && pinchStartDist !== null) {
          const dist = getTouchDistance(e.touches);
          const scale = dist / pinchStartDist;
          const newSize = Math.round(pinchStartFontSize * scale);
          if (newSize !== term.options.fontSize && newSize >= 6 && newSize <= 32) {
            // Dispatch to font size manager via custom event
            container.dispatchEvent(new CustomEvent('pinch-zoom', { detail: { fontSize: newSize } }));
          }
          e.preventDefault();
          return;
        }

        // --- Single finger: scroll or swipe ---
        if (touchStartY === null || e.touches.length !== 1) return;

        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const deltaY = touchStartY - currentY;
        const deltaX = currentX - touchStartX;

        // Lock direction on first significant movement
        if (gestureDirection === null && (Math.abs(deltaY) > DIRECTION_LOCK_PX || Math.abs(deltaX) > DIRECTION_LOCK_PX)) {
          if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            gestureDirection = 'swipe';
          } else {
            gestureDirection = 'scroll';
          }
        }

        if (gestureDirection === 'swipe') {
          // Show arrow indicators based on swipe progress
          const screenWidth = window.innerWidth;
          const progress = Math.abs(deltaX) / screenWidth;

          if (swipeLeftEl && swipeRightEl) {
            if (deltaX > DIRECTION_LOCK_PX) {
              swipeRightEl.classList.add('visible');
              swipeLeftEl.classList.remove('visible');
            } else if (deltaX < -DIRECTION_LOCK_PX) {
              swipeLeftEl.classList.add('visible');
              swipeRightEl.classList.remove('visible');
            } else {
              swipeLeftEl.classList.remove('visible');
              swipeRightEl.classList.remove('visible');
            }
          }
          e.preventDefault();
          return;
        }

        if (gestureDirection === 'scroll') {
          const delta = touchStartY - currentY;
          touchStartY = currentY;
          if (Math.abs(delta) < 2) return;

          scrollAccumulator += delta;
          const lines = Math.trunc(scrollAccumulator / PX_PER_LINE);
          if (lines !== 0) {
            scrollAccumulator -= lines * PX_PER_LINE;
            const button = lines > 0 ? 65 : 64;
            const count = Math.min(Math.abs(lines), MAX_LINES_PER_FRAME);
            const seq = `\x1b[<${button};1;1M`;
            for (let i = 0; i < count; i++) {
              sendKeys(seq);
            }
          }
          e.preventDefault();
        }
      }, { passive: false });

      screen.addEventListener('touchend', (e) => {
        // --- Pinch end ---
        if (pinchStartDist !== null && e.touches.length < 2) {
          pinchStartDist = null;
          pinchStartFontSize = null;
          return;
        }

        // --- Swipe end: check if threshold was met ---
        if (gestureDirection === 'swipe' && touchStartX !== null) {
          const endX = e.changedTouches[0]?.clientX ?? touchStartX;
          const deltaX = endX - touchStartX;
          const screenWidth = window.innerWidth;

          if (Math.abs(deltaX) > screenWidth * SWIPE_THRESHOLD) {
            // Trigger session switch
            container.dispatchEvent(new CustomEvent('swipe-session', {
              detail: { direction: deltaX > 0 ? 'next' : 'prev' },
            }));
          }
        }

        // Hide arrows
        if (swipeLeftEl) swipeLeftEl.classList.remove('visible');
        if (swipeRightEl) swipeRightEl.classList.remove('visible');

        touchStartY = null;
        touchStartX = null;
        scrollAccumulator = 0;
        gestureDirection = null;
      }, { passive: true });
    };

    requestAnimationFrame(attachGestures);
  }

  function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
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

  function newWindow(targetSession) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'new-window',
        session: targetSession,
      }));
    }
  }

  function dispose() {
    resizeObserver.disconnect();
    ws.close();
    term.dispose();
  }

  return { term, ws, fitAddon, searchAddon, setFontSize, sendKeys, switchWindow, newWindow, dispose };
}
