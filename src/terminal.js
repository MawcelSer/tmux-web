import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

const THEME = {
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

  if (!compHelper ||
      typeof compHelper._handleAnyTextareaChanges !== 'function' ||
      !('_isComposing' in compHelper) ||
      !('_coreService' in compHelper) ||
      !('_textarea' in compHelper)) {
    return;
  }

  let firstOldValue = null;
  let pendingTimer = null;

  compHelper._handleAnyTextareaChanges = function() {
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
      while (prefixLen < minLen && oldValue[prefixLen] === newValue[prefixLen]) {
        prefixLen++;
      }

      let suffixLen = 0;
      while (suffixLen < (minLen - prefixLen) &&
             oldValue[oldValue.length - 1 - suffixLen] === newValue[newValue.length - 1 - suffixLen]) {
        suffixLen++;
      }

      const deleted = oldValue.substring(prefixLen, oldValue.length - suffixLen);
      const added = newValue.substring(prefixLen, newValue.length - suffixLen);

      for (let k = 0; k < deleted.length; k++) {
        this._coreService.triggerDataEvent('\x7f', true);
      }
      if (added.length > 0) {
        this._dataAlreadySent = added;
        this._coreService.triggerDataEvent(added, true);
      }
    }, 15);
  };
}

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Set up touch gestures: scroll, swipe, pinch.
 * Taps flow through to browser (click synthesis).
 */
function setupTouchGestures(container, term, sendKeysFn) {
  let touchStartY = null;
  let touchStartX = null;
  let scrollAccumulator = 0;
  let lastScrollSend = 0;
  let gestureDirection = null; // null | 'scroll' | 'swipe'
  const PX_PER_LINE = 20;
  const SCROLL_THROTTLE_MS = 60;
  const SWIPE_THRESHOLD = 0.4;
  const DIRECTION_LOCK_PX = 10;

  let scrollDrainTimer = null;
  let pinchStartDist = null;
  let pinchStartFontSize = null;

  const swipeLeftEl = document.getElementById('swipe-left');
  const swipeRightEl = document.getElementById('swipe-right');

  function flushScroll() {
    const lines = Math.trunc(scrollAccumulator / PX_PER_LINE);
    if (lines === 0) {
      stopScrollDrain();
      return;
    }
    const sign = lines > 0 ? 1 : -1;
    const capped = Math.min(Math.abs(lines), 5);
    scrollAccumulator -= sign * capped * PX_PER_LINE;
    const button = sign > 0 ? 65 : 64;
    sendKeysFn(`\x1b[<${button};1;1M`.repeat(capped));
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
      scrollAccumulator = 0;
      stopScrollDrain();
      gestureDirection = null;
    }
  }, { capture: true, passive: false });

  container.addEventListener('touchmove', (e) => {
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

    if (gestureDirection === null) {
      if (Math.abs(deltaY) > DIRECTION_LOCK_PX || Math.abs(deltaX) > DIRECTION_LOCK_PX) {
        gestureDirection = Math.abs(deltaX) > Math.abs(deltaY) * 1.5 ? 'swipe' : 'scroll';
      } else {
        return;
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
    if (pinchStartDist !== null && e.touches.length < 2) {
      pinchStartDist = null;
      pinchStartFontSize = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (gestureDirection === 'swipe' && touchStartX !== null) {
      const endX = e.changedTouches[0]?.clientX ?? touchStartX;
      const deltaX = endX - touchStartX;
      if (Math.abs(deltaX) > window.innerWidth * SWIPE_THRESHOLD) {
        container.dispatchEvent(new CustomEvent('swipe-session', {
          detail: { direction: deltaX > 0 ? 'next' : 'prev' },
        }));
      }
    }

    if (gestureDirection !== null) {
      if (gestureDirection === 'scroll') flushScroll();
      e.preventDefault();
    }

    if (swipeLeftEl) swipeLeftEl.classList.remove('visible');
    if (swipeRightEl) swipeRightEl.classList.remove('visible');

    touchStartY = null;
    touchStartX = null;
    scrollAccumulator = 0;
    gestureDirection = null;
  }, { capture: true, passive: false });
}

export function createTerminal(container, { session, fontSize = 14, onDataTransform }) {
  const term = new Terminal({
    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
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
  const helperTextarea = container.querySelector('.xterm-helper-textarea');
  if (helperTextarea) {
    helperTextarea.setAttribute('autocapitalize', 'none');
  }

  patchSwiftKeyComposition(term);

  requestAnimationFrame(() => fitAddon.fit());

  // --- WebSocket with auto-reconnect ---
  let ws = null;
  let currentSession = session;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  let intentionalClose = false;

  function wsSend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }

  function connect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws?session=${encodeURIComponent(currentSession || '')}`;
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
      wsSend(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });

    ws.addEventListener('message', (event) => {
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data;
      term.write(data);
    });

    ws.addEventListener('close', (event) => {
      if (intentionalClose) return;
      if (event.code === 1000 && event.reason === 'Replaced by new connection') {
        term.write('\r\n\x1b[1;33m[Session taken by another connection]\x1b[0m\r\n');
        return;
      }
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
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
      reconnectDelay = 1000;
      connect();
    }
  });

  term.onData((data) => {
    wsSend(onDataTransform ? onDataTransform(data) : data);
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
    wsSend(JSON.stringify({ type: 'resize', cols, rows }));
  });

  // --- Touch gestures ---
  function sendKeys(seq) { wsSend(seq); }
  setupTouchGestures(container, term, sendKeys);

  function setFontSize(size) {
    term.options.fontSize = size;
    lastCols = 0;
    lastRows = 0;
    fitAddon.fit();
  }

  function switchWindow(targetSession, windowIndex) {
    currentSession = targetSession;
    wsSend(JSON.stringify({ type: 'switch', session: targetSession, window: windowIndex }));
  }

  function newWindow(targetSession) {
    wsSend(JSON.stringify({ type: 'new-window', session: targetSession }));
  }

  function newSession(name) {
    wsSend(JSON.stringify({ type: 'new-session', name }));
  }

  function killSession(name) {
    wsSend(JSON.stringify({ type: 'kill-session', name }));
  }

  function killWindow(sessionName, windowIndex) {
    wsSend(JSON.stringify({ type: 'kill-window', session: sessionName, window: windowIndex }));
  }

  function dispose() {
    intentionalClose = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    resizeObserver.disconnect();
    if (ws) ws.close();
    term.dispose();
  }

  return {
    term, searchAddon, setFontSize, sendKeys, switchWindow,
    newWindow, newSession, killSession, killWindow, dispose,
    fit: debouncedFit,
  };
}
