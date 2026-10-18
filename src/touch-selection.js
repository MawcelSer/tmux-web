/**
 * Touch text selection on the terminal grid, drawn with xterm's own
 * selection (term.select) so it works even while tmux has mouse mode on.
 * Points are { col, row } with `row` in buffer coordinates.
 */

// Grips are HANDLE_SIZE_PX squares hanging below the selection ends (keep in
// sync with .selection-handle in style.css); a touch this close grabs one
const HANDLE_SIZE_PX = 22;
const HANDLE_HIT_RADIUS_PX = 32;
const WORD_CHAR_RE = /\S/;
const NO_OFFSET = { dx: 0, dy: 0 };

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const compare = (p, q) => p.row - q.row || p.col - q.col;
const ordered = (p, q) => (compare(p, q) <= 0 ? [p, q] : [q, p]);

/**
 * @param {object} opts
 * @param {import("@xterm/xterm").Terminal} opts.term
 * @param {HTMLElement} opts.container - positioned parent for the handles
 * @param {() => HTMLElement | null} opts.getScreen - the .xterm-screen
 * @param {(active: boolean) => void} [opts.onChange]
 */
export function createTouchSelection({
  term,
  container,
  getScreen,
  onChange = () => {},
}) {
  let start = null;
  let end = null;
  let word = null; // [start, end] of the long-pressed word (drag anchor)
  let handles = null;
  let applying = false;
  let drag = null; // { handle, fixed, dx, dy } while a handle is held
  let snapshot = ""; // selected text when last applied

  function cellSize() {
    const rect = getScreen().getBoundingClientRect();
    return {
      rect,
      width: rect.width / term.cols,
      height: rect.height / term.rows,
    };
  }

  function pointAt(x, y) {
    const { rect, width, height } = cellSize();
    const col = clamp(Math.floor((x - rect.left) / width), 0, term.cols - 1);
    const viewRow = clamp(
      Math.floor((y - rect.top) / height),
      0,
      term.rows - 1,
    );
    return { col, row: term.buffer.active.viewportY + viewRow };
  }

  /**
   * Whether each cell of a row is part of a word. Walks cells rather than
   * the line string: a wide (CJK/emoji) character fills two cells, the
   * second being an empty width-0 continuation of the first.
   */
  function wordCells(row) {
    const line = term.buffer.active.getLine(row);
    const result = [];
    for (let col = 0; col < term.cols; col++) {
      const cell = line?.getCell(col);
      result.push(
        cell?.getWidth() === 0 && col > 0
          ? result[col - 1]
          : WORD_CHAR_RE.test(cell?.getChars() ?? ""),
      );
    }
    return result;
  }

  /** Non-whitespace run around the point (paths, URLs, flags…). */
  function wordAt(point) {
    const isWord = wordCells(point.row);
    if (!isWord[point.col]) return [point, point];
    let from = point.col;
    let to = point.col;
    while (from > 0 && isWord[from - 1]) from--;
    while (to < term.cols - 1 && isWord[to + 1]) to++;
    return [
      { col: from, row: point.row },
      { col: to, row: point.row },
    ];
  }

  function ensureHandles() {
    if (handles) return handles;
    const make = (which) => {
      const el = document.createElement("div");
      el.className = `selection-handle selection-handle-${which}`;
      container.appendChild(el);
      return el;
    };
    handles = { start: make("start"), end: make("end") };
    return handles;
  }

  function removeHandles() {
    handles?.start.remove();
    handles?.end.remove();
    handles = null;
  }

  function positionHandles() {
    const { rect, width, height } = cellSize();
    const box = container.getBoundingClientRect();
    const viewportY = term.buffer.active.viewportY;
    const place = (el, point, edge) => {
      el.style.left = `${rect.left - box.left + (point.col + edge) * width}px`;
      el.style.top = `${rect.top - box.top + (point.row - viewportY + 1) * height}px`;
    };
    const { start: s, end: e } = ensureHandles();
    place(s, start, 0);
    place(e, end, 1);
  }

  function apply() {
    const length = (end.row - start.row) * term.cols + end.col - start.col + 1;
    applying = true;
    try {
      term.select(start.col, start.row, length);
    } finally {
      applying = false;
    }
    snapshot = term.getSelection();
    positionHandles();
  }

  function deactivate() {
    const wasActive = start !== null;
    start = null;
    end = null;
    word = null;
    drag = null;
    removeHandles();
    if (wasActive) onChange(false);
  }

  // Typing, output reflow, etc. make xterm drop the selection: follow it
  term.onSelectionChange(() => {
    if (!applying && start !== null && !term.hasSelection()) deactivate();
  });

  // xterm keeps the highlight when output rewrites those cells (tmux
  // redraws, tail -f…). Drop it so Copy never copies text the user didn't see.
  term.onWriteParsed(() => {
    if (start !== null && term.getSelection() !== snapshot) {
      term.clearSelection();
      deactivate();
    }
  });

  /** Client-pixel centre of a drawn grip (start hangs left, end right). */
  function gripCenter(which) {
    const { rect, width, height } = cellSize();
    const viewportY = term.buffer.active.viewportY;
    const point = which === "start" ? start : end;
    const edgeX = rect.left + (point.col + (which === "start" ? 0 : 1)) * width;
    const half = HANDLE_SIZE_PX / 2;
    return {
      x: which === "start" ? edgeX - half : edgeX + half,
      y: rect.top + (point.row - viewportY + 1) * height + half,
    };
  }

  /** Pixel centre of a cell, for grab offsets. */
  function cellCenter(point) {
    const { rect, width, height } = cellSize();
    const viewRow = point.row - term.buffer.active.viewportY;
    return {
      x: rect.left + (point.col + 0.5) * width,
      y: rect.top + (viewRow + 0.5) * height,
    };
  }

  return {
    isActive: () => start !== null,

    /** Long-press: select the word under the finger. */
    startAt(x, y) {
      drag = null;
      word = wordAt(pointAt(x, y));
      [start, end] = word;
      apply();
      onChange(true);
    },

    /**
     * Move a selection end. `handle` "start"/"end" drags that end; omitted,
     * it's the long-press drag, which keeps the pressed word selected.
     */
    dragTo(x, y, handle) {
      if (start === null) return;
      if (handle) {
        if (drag?.handle !== handle) {
          drag = {
            handle,
            fixed: handle === "start" ? end : start,
            ...NO_OFFSET,
          };
        }
        // The other end stays put even if the handles cross over
        [start, end] = ordered(drag.fixed, pointAt(x - drag.dx, y - drag.dy));
        apply();
        return;
      }
      const p = pointAt(x, y);
      if (compare(p, word[0]) < 0) [start, end] = [p, word[1]];
      else [start, end] = [word[0], compare(p, word[1]) > 0 ? p : word[1]];
      apply();
    },

    /**
     * A handle was grabbed at (x, y): remember the far end (fixed for the
     * whole drag) and where on the grip the finger is, so the selection
     * doesn't jump to the finger's row.
     */
    grab(handle, x, y) {
      if (start === null) return;
      const point = handle === "start" ? start : end;
      const centre = cellCenter(point);
      drag = {
        handle,
        fixed: handle === "start" ? end : start,
        dx: x - centre.x,
        dy: y - centre.y,
      };
    },

    /**
     * Which handle (if any) a touch at (x, y) grabs: the closest grip within
     * a finger-sized radius. Measured in px — cell units would make the
     * target tiny with a phone-sized font.
     */
    hitHandle(x, y) {
      if (start === null) return null;
      const distance = (which) => {
        const c = gripCenter(which);
        return Math.hypot(x - c.x, y - c.y);
      };
      const dStart = distance("start");
      const dEnd = distance("end");
      if (Math.min(dStart, dEnd) > HANDLE_HIT_RADIUS_PX) return null;
      return dEnd <= dStart ? "end" : "start";
    },

    /** Select everything visible. */
    selectScreen() {
      drag = null;
      const top = term.buffer.active.viewportY;
      start = { col: 0, row: top };
      end = { col: term.cols - 1, row: top + term.rows - 1 };
      word = [start, end];
      apply();
      onChange(true);
    },

    getText: () => term.getSelection(),

    clear() {
      term.clearSelection();
      deactivate();
    },
  };
}
