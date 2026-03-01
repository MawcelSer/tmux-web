import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

export function createTerminal(container, { session, fontSize = 14, onDataTransform }) {
  const term = new Terminal({
    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    theme: {
      background: '#101b2c',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#101b2c',
      selectionBackground: 'rgba(31, 111, 235, 0.3)',
      black: '#101b2c',
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

  // --- WebSocket with auto-reconnect ---
  let ws = null;
  let currentSession = session;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  let intentionalClose = false;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws?session=${encodeURIComponent(currentSession || '')}`;
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
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
      if (intentionalClose) return;
      term.write('\r\n\x1b[1;33m[Reconnecting...]\x1b[0m\r\n');
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }, reconnectDelay);
  }

  connect();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState !== WebSocket.OPEN)) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectDelay = 1000;
      connect();
    }
  });

  // Send data with optional modifier transform
  term.onData((data) => {
    const transformed = onDataTransform ? onDataTransform(data) : data;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(transformed);
    }
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
  });
  resizeObserver.observe(container);

  term.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  // --- Touch gestures ---
  // Handles: tap (move cursor), long-press (select+copy), scroll, swipe, pinch
  {
    let touchStartY = null;
    let touchStartX = null;
    let touchStartTime = null;
    let scrollAccumulator = 0;
    let gestureDirection = null; // null | 'scroll' | 'swipe' | 'select'
    const PX_PER_LINE = 24;
    const MAX_LINES_PER_FRAME = 5;
    const SWIPE_THRESHOLD = 0.4;
    const DIRECTION_LOCK_PX = 10;
    const LONG_PRESS_MS = 500;
    const TAP_MAX_MS = 300;
    const TAP_MAX_PX = 5;

    let pinchStartDist = null;
    let pinchStartFontSize = null;
    let longPressTimer = null;
    let selectionAnchor = null; // { col, row (buffer), endCol, endRow }

    const swipeLeftEl = document.getElementById('swipe-left');
    const swipeRightEl = document.getElementById('swipe-right');

    // Convert pixel coordinates to terminal cell
    function coordsToCell(clientX, clientY) {
      const screen = container.querySelector('.xterm-screen');
      if (!screen) return null;
      const rect = screen.getBoundingClientRect();
      const cellWidth = rect.width / term.cols;
      const cellHeight = rect.height / term.rows;
      const col = Math.max(0, Math.min(term.cols - 1, Math.floor((clientX - rect.left) / cellWidth)));
      const row = Math.max(0, Math.min(term.rows - 1, Math.floor((clientY - rect.top) / cellHeight)));
      return { col, row };
    }

    function toBufferRow(viewportRow) {
      return viewportRow + term.buffer.active.viewportY;
    }

    // Select the word at (col, viewportRow), returns anchor info
    function selectWordAt(col, viewportRow) {
      const bRow = toBufferRow(viewportRow);
      const line = term.buffer.active.getLine(bRow);
      if (!line) return;

      let start = col;
      let end = col;
      const isWordChar = (c) => /[\w\-./~]/.test(c);

      const cell = line.getCell(col);
      const ch = cell ? cell.getChars() : '';

      if (ch && isWordChar(ch)) {
        while (start > 0) {
          const c = line.getCell(start - 1);
          if (!c || !isWordChar(c.getChars())) break;
          start--;
        }
        while (end < term.cols - 1) {
          const c = line.getCell(end + 1);
          if (!c || !isWordChar(c.getChars())) break;
          end++;
        }
      }

      term.select(start, bRow, end - start + 1);
      selectionAnchor = { col: start, row: bRow, endCol: end, endRow: bRow };
    }

    // Extend selection from anchor to (col, viewportRow)
    function extendSelectionTo(col, viewportRow) {
      if (!selectionAnchor) return;
      const bRow = toBufferRow(viewportRow);

      let startCol, startRow, endCol, endRow;
      if (bRow < selectionAnchor.row || (bRow === selectionAnchor.row && col < selectionAnchor.col)) {
        startCol = col;
        startRow = bRow;
        endCol = selectionAnchor.endCol;
        endRow = selectionAnchor.endRow;
      } else {
        startCol = selectionAnchor.col;
        startRow = selectionAnchor.row;
        endCol = col;
        endRow = bRow;
      }

      const length = (endRow - startRow) * term.cols + (endCol - startCol + 1);
      term.select(startCol, startRow, Math.max(1, length));
    }

    // Copy current selection to clipboard
    function copySelection() {
      const text = term.getSelection();
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
        showCopiedToast();
      }
    }

    function showCopiedToast() {
      let toast = document.getElementById('copy-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'copy-toast';
        toast.className = 'copy-toast';
        toast.textContent = 'Copied';
        document.body.appendChild(toast);
      }
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 1000);
    }

    // Tap-to-move: send arrow keys to reach target column on cursor's row
    function moveCursorTo(col, viewportRow) {
      if (term.buffer.active.viewportY !== term.buffer.active.baseY) return;
      if (viewportRow !== term.buffer.active.cursorY) return;

      const delta = col - term.buffer.active.cursorX;
      if (delta === 0) return;

      const arrow = delta > 0 ? '\x1b[C' : '\x1b[D';
      sendKeys(arrow.repeat(Math.abs(delta)));
    }

    function clearLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    const attachGestures = () => {
      const screen = container.querySelector('.xterm-screen');
      if (!screen) return;

      screen.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          pinchStartDist = getTouchDistance(e.touches);
          pinchStartFontSize = term.options.fontSize;
          touchStartY = null;
          gestureDirection = null;
          clearLongPress();
          e.preventDefault();
          return;
        }
        if (e.touches.length === 1) {
          touchStartY = e.touches[0].clientY;
          touchStartX = e.touches[0].clientX;
          touchStartTime = Date.now();
          scrollAccumulator = 0;
          gestureDirection = null;
          selectionAnchor = null;
          term.clearSelection();

          // Long-press timer for text selection
          clearLongPress();
          const sx = e.touches[0].clientX;
          const sy = e.touches[0].clientY;
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            gestureDirection = 'select';
            const cell = coordsToCell(sx, sy);
            if (cell) {
              selectWordAt(cell.col, cell.row);
              if (navigator.vibrate) navigator.vibrate(30);
            }
          }, LONG_PRESS_MS);
        }
      }, { passive: false });

      screen.addEventListener('touchmove', (e) => {
        // --- Pinch zoom ---
        if (e.touches.length === 2 && pinchStartDist !== null) {
          const dist = getTouchDistance(e.touches);
          const scale = dist / pinchStartDist;
          const newSize = Math.round(pinchStartFontSize * scale);
          if (newSize !== term.options.fontSize && newSize >= 6 && newSize <= 32) {
            container.dispatchEvent(new CustomEvent('pinch-zoom', { detail: { fontSize: newSize } }));
          }
          e.preventDefault();
          return;
        }

        if (touchStartY === null || e.touches.length !== 1) return;

        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const deltaY = touchStartY - currentY;
        const deltaX = currentX - touchStartX;

        // Cancel long-press on significant movement
        if (longPressTimer && (Math.abs(touchStartY - currentY) > TAP_MAX_PX || Math.abs(deltaX) > TAP_MAX_PX)) {
          clearLongPress();
        }

        // --- Selection mode: extend selection on drag ---
        if (gestureDirection === 'select') {
          const cell = coordsToCell(currentX, currentY);
          if (cell) {
            extendSelectionTo(cell.col, cell.row);
          }
          e.preventDefault();
          return;
        }

        // Lock direction on first significant movement
        if (gestureDirection === null && (Math.abs(deltaY) > DIRECTION_LOCK_PX || Math.abs(deltaX) > DIRECTION_LOCK_PX)) {
          if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            gestureDirection = 'swipe';
          } else {
            gestureDirection = 'scroll';
          }
        }

        if (gestureDirection === 'swipe') {
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
        clearLongPress();

        // --- Pinch end ---
        if (pinchStartDist !== null && e.touches.length < 2) {
          pinchStartDist = null;
          pinchStartFontSize = null;
          return;
        }

        // --- Selection end: copy to clipboard ---
        if (gestureDirection === 'select') {
          copySelection();
          selectionAnchor = null;
          setTimeout(() => term.clearSelection(), 800);
          touchStartY = null;
          touchStartX = null;
          touchStartTime = null;
          gestureDirection = null;
          return;
        }

        // --- Swipe end ---
        if (gestureDirection === 'swipe' && touchStartX !== null) {
          const endX = e.changedTouches[0]?.clientX ?? touchStartX;
          const deltaX = endX - touchStartX;
          const screenWidth = window.innerWidth;

          if (Math.abs(deltaX) > screenWidth * SWIPE_THRESHOLD) {
            container.dispatchEvent(new CustomEvent('swipe-session', {
              detail: { direction: deltaX > 0 ? 'next' : 'prev' },
            }));
          }
        }

        // --- Quick tap: move cursor to tapped position ---
        if (gestureDirection === null && touchStartTime) {
          const duration = Date.now() - touchStartTime;
          const endTouch = e.changedTouches[0];
          if (endTouch && touchStartX !== null && touchStartY !== null) {
            const dx = Math.abs(endTouch.clientX - touchStartX);
            const dy = Math.abs(endTouch.clientY - touchStartY);
            if (duration < TAP_MAX_MS && dx < TAP_MAX_PX && dy < TAP_MAX_PX) {
              const cell = coordsToCell(endTouch.clientX, endTouch.clientY);
              if (cell) {
                moveCursorTo(cell.col, cell.row);
              }
            }
          }
        }

        // Hide arrows
        if (swipeLeftEl) swipeLeftEl.classList.remove('visible');
        if (swipeRightEl) swipeRightEl.classList.remove('visible');

        touchStartY = null;
        touchStartX = null;
        touchStartTime = null;
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(seq);
    }
  }

  function switchWindow(targetSession, windowIndex) {
    currentSession = targetSession;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'switch',
        session: targetSession,
        window: windowIndex,
      }));
    }
  }

  function newWindow(targetSession) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'new-window',
        session: targetSession,
      }));
    }
  }

  function dispose() {
    intentionalClose = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    resizeObserver.disconnect();
    if (ws) ws.close();
    term.dispose();
  }

  return { term, fitAddon, searchAddon, setFontSize, sendKeys, switchWindow, newWindow, dispose };
}
