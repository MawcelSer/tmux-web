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
      // Close any lingering connection in CONNECTING or CLOSING state
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
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

  // Handle resize — debounced to avoid excessive redraws that scroll to bottom
  let fitTimer = null;
  let lastCols = term.cols;
  let lastRows = term.rows;

  function debouncedFit() {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      fitTimer = null;
      const proposedDims = fitAddon.proposeDimensions();
      if (proposedDims && (proposedDims.cols !== lastCols || proposedDims.rows !== lastRows)) {
        lastCols = proposedDims.cols;
        lastRows = proposedDims.rows;
        fitAddon.fit();
      }
    }, 150);
  }

  const resizeObserver = new ResizeObserver(() => {
    debouncedFit();
  });
  resizeObserver.observe(container);

  term.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  // --- Touch gestures ---
  // Handles: tap (move cursor), scroll, swipe, pinch
  {
    let touchStartY = null;
    let touchStartX = null;
    let touchStartTime = null;
    let scrollAccumulator = 0;
    let lastScrollSend = 0;
    let gestureDirection = null; // null | 'scroll' | 'swipe'
    const PX_PER_LINE = 20;
    const SCROLL_THROTTLE_MS = 60;
    const SWIPE_THRESHOLD = 0.4;
    const DIRECTION_LOCK_PX = 10;
    const TAP_MAX_MS = 300;
    const TAP_MAX_PX = 5;

    let scrollDrainTimer = null;
    let pinchStartDist = null;
    let pinchStartFontSize = null;

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

    // Tap-to-move: send arrow keys to reach target column on cursor's row
    function moveCursorTo(col, viewportRow) {
      if (term.buffer.active.viewportY !== term.buffer.active.baseY) return;
      if (viewportRow !== term.buffer.active.cursorY) return;

      const delta = col - term.buffer.active.cursorX;
      if (delta === 0) return;

      const arrow = delta > 0 ? '\x1b[C' : '\x1b[D';
      sendKeys(arrow.repeat(Math.abs(delta)));
    }

    function flushScroll() {
      const lines = Math.trunc(scrollAccumulator / PX_PER_LINE);
      if (lines === 0) {
        stopScrollDrain();
        return;
      }
      // Cap lines per flush to avoid flooding tmux with redraws
      const sign = lines > 0 ? 1 : -1;
      const capped = Math.min(Math.abs(lines), 5);
      scrollAccumulator -= sign * capped * PX_PER_LINE;
      const button = sign > 0 ? 65 : 64;
      sendKeys(`\x1b[<${button};1;1M`.repeat(capped));
      // If there's still accumulated scroll, keep draining
      if (Math.abs(scrollAccumulator) >= PX_PER_LINE) {
        startScrollDrain();
      } else {
        stopScrollDrain();
      }
    }

    function startScrollDrain() {
      if (!scrollDrainTimer) {
        scrollDrainTimer = setInterval(flushScroll, SCROLL_THROTTLE_MS);
      }
    }

    function stopScrollDrain() {
      if (scrollDrainTimer) {
        clearInterval(scrollDrainTimer);
        scrollDrainTimer = null;
      }
    }

    // Attach on the container (parent) with capture so we intercept
    // touch events BEFORE xterm.js sees them on .xterm-screen.
    container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = getTouchDistance(e.touches);
        pinchStartFontSize = term.options.fontSize;
        touchStartY = null;
        gestureDirection = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        touchStartTime = Date.now();
        scrollAccumulator = 0;
        stopScrollDrain();
        gestureDirection = null;
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true, passive: false });

    container.addEventListener('touchmove', (e) => {
      // --- Pinch zoom ---
      if (e.touches.length === 2 && pinchStartDist !== null) {
        const dist = getTouchDistance(e.touches);
        const scale = dist / pinchStartDist;
        const newSize = Math.round(pinchStartFontSize * scale);
        if (newSize !== term.options.fontSize && newSize >= 6 && newSize <= 32) {
          container.dispatchEvent(new CustomEvent('pinch-zoom', { detail: { fontSize: newSize } }));
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

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
        e.stopPropagation();
        return;
      }

      if (gestureDirection === 'scroll') {
        const delta = touchStartY - currentY;
        touchStartY = currentY;
        if (Math.abs(delta) < 2) return;

        scrollAccumulator += delta;

        // Throttle: accumulate movement, flush at most every 60ms
        const now = Date.now();
        if (now - lastScrollSend >= SCROLL_THROTTLE_MS) {
          flushScroll();
          lastScrollSend = now;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true, passive: false });

    container.addEventListener('touchend', (e) => {
      // --- Pinch end ---
      if (pinchStartDist !== null && e.touches.length < 2) {
        pinchStartDist = null;
        pinchStartFontSize = null;
        e.stopPropagation();
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

      // --- Quick tap: move cursor to tapped position + re-focus ---
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
            term.focus();
          }
        }
      }

      // Flush any remaining scroll before resetting
      if (gestureDirection === 'scroll') {
        flushScroll();
      }

      // Hide arrows
      if (swipeLeftEl) swipeLeftEl.classList.remove('visible');
      if (swipeRightEl) swipeRightEl.classList.remove('visible');

      touchStartY = null;
      touchStartX = null;
      touchStartTime = null;
      scrollAccumulator = 0;
      gestureDirection = null;
      e.stopPropagation();
    }, { capture: true, passive: false });
  }

  function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function setFontSize(size) {
    term.options.fontSize = size;
    lastCols = 0; // force re-fit
    lastRows = 0;
    fitAddon.fit();
  }

  function fit() {
    debouncedFit();
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

  return { term, fit, searchAddon, setFontSize, sendKeys, switchWindow, newWindow, dispose };
}
