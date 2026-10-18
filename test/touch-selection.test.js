// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTouchSelection } from "../src/touch-selection.js";

const CELL_W = 10;
const CELL_H = 20;

/**
 * Line in xterm's cell model. Strings are width-1 cells; an array may hold
 * [char, 2] for a wide character, which xterm stores as the char followed
 * by an empty width-0 continuation cell.
 */
function toLine(spec) {
  const cells = [];
  for (const item of Array.isArray(spec) ? spec : [...spec]) {
    if (Array.isArray(item)) {
      cells.push({ chars: item[0], width: 2 }, { chars: "", width: 0 });
    } else {
      cells.push({ chars: item, width: 1 });
    }
  }
  while (cells.length < 20) cells.push({ chars: "", width: 1 });
  return {
    getCell: (col) =>
      cells[col] && {
        getChars: () => cells[col].chars,
        getWidth: () => cells[col].width,
      },
    translateToString: () => cells.map((c) => c.chars || " ").join(""),
  };
}

/** Fake xterm: 20 cols × 4 rows, viewport scrolled by `viewportY`. */
function makeTerm(lines, { viewportY = 0 } = {}) {
  const selectionListeners = [];
  const writeListeners = [];
  const term = {
    cols: 20,
    rows: 4,
    buffer: {
      active: {
        viewportY,
        getLine: (row) =>
          lines[row] === undefined ? undefined : toLine(lines[row]),
      },
    },
    selected: null,
    select: vi.fn((col, row, length) => {
      term.selected = { col, row, length };
    }),
    clearSelection: vi.fn(() => {
      term.selected = null;
      selectionListeners.forEach((cb) => cb());
    }),
    hasSelection: () => term.selected !== null,
    selectionText: "selected text",
    getSelection: () => term.selectionText,
    onSelectionChange: (cb) => selectionListeners.push(cb),
    onWriteParsed: (cb) => writeListeners.push(cb),
    /** Simulate output being parsed (e.g. tmux redraw). */
    emitWrite: () => writeListeners.forEach((cb) => cb()),
  };
  return term;
}

function makeDom() {
  const container = document.createElement("div");
  const screen = document.createElement("div");
  container.appendChild(screen);
  document.body.replaceChildren(container);
  const rect = {
    left: 0,
    top: 0,
    width: 200,
    height: 80,
    right: 200,
    bottom: 80,
  };
  screen.getBoundingClientRect = () => rect;
  container.getBoundingClientRect = () => rect;
  return { container, screen };
}

/** Client coordinates of the centre of a cell. */
const at = (col, row) => [col * CELL_W + 5, row * CELL_H + 10];

describe("createTouchSelection", () => {
  let term;
  let sel;
  let onChange;

  beforeEach(() => {
    term = makeTerm(["$ cat /etc/hosts.txt", "line two here", "", "end"]);
    const { container, screen } = makeDom();
    onChange = vi.fn();
    sel = createTouchSelection({
      term,
      container,
      getScreen: () => screen,
      onChange,
    });
  });

  it("long-press selects the whole word/path under the finger", () => {
    sel.startAt(...at(8, 0)); // inside "/etc/hosts.txt"
    expect(term.select).toHaveBeenLastCalledWith(6, 0, 14);
    expect(sel.isActive()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("on blank space it selects the single cell", () => {
    sel.startAt(...at(5, 2));
    expect(term.select).toHaveBeenLastCalledWith(5, 2, 1);
  });

  it("dragging extends across lines (length wraps by cols)", () => {
    sel.startAt(...at(8, 0)); // word = cols 6..19 on row 0
    sel.dragTo(...at(3, 1)); // extend to row 1 col 3
    // from (6,0) to (3,1): 20 - 6 + 3 + 1 = 18 cells
    expect(term.select).toHaveBeenLastCalledWith(6, 0, 18);
  });

  it("dragging before the anchor selects backwards", () => {
    sel.startAt(...at(10, 1)); // "here" cols 9..12 on row 1
    sel.dragTo(...at(2, 0));
    // from (2,0) to end of word (12,1): 20 - 2 + 12 + 1 = 31
    expect(term.select).toHaveBeenLastCalledWith(2, 0, 31);
  });

  it("uses buffer rows when the viewport is scrolled", () => {
    term = makeTerm(["", "", "", "", "", "word"], { viewportY: 5 });
    const { container, screen } = makeDom();
    sel = createTouchSelection({ term, container, getScreen: () => screen });
    sel.startAt(...at(1, 0));
    expect(term.select).toHaveBeenLastCalledWith(0, 5, 4);
  });

  it("clamps touches outside the screen to the edges", () => {
    sel.startAt(...at(8, 0));
    sel.dragTo(500, 500);
    expect(term.select).toHaveBeenLastCalledWith(6, 0, 20 * 3 + 19 - 6 + 1);
  });

  it("finds the handle near a touch so either end can be dragged", () => {
    sel.startAt(...at(10, 1)); // cols 9..12, row 1
    expect(sel.hitHandle(...at(9, 1))).toBe("start");
    expect(sel.hitHandle(9 * CELL_W, 2 * CELL_H + 8)).toBe("start"); // grip below
    expect(sel.hitHandle(...at(12, 1))).toBe("end");
    expect(sel.hitHandle(...at(2, 3))).toBeNull();
  });

  it("grabs a handle anywhere on its drawn grip (finger-sized, in px)", () => {
    sel.startAt(...at(10, 1)); // start edge x=90, row bottom y=40
    // left part of the start grip, which hangs left of and below the text
    expect(sel.hitHandle(74, 52)).toBe("start");
    // right part of the end grip (end edge x=130)
    expect(sel.hitHandle(146, 52)).toBe("end");
    // far away
    expect(sel.hitHandle(30, 75)).toBeNull();
  });

  it("picks the closer handle when both are in reach (short selection)", () => {
    sel.startAt(...at(1, 3)); // "end" = cols 0..2, row 3
    expect(sel.hitHandle(-2, 72)).toBe("start");
    expect(sel.hitHandle(36, 72)).toBe("end");
  });

  it("dragging the start handle moves the start", () => {
    sel.startAt(...at(10, 1)); // 9..12
    sel.dragTo(...at(4, 1), "start");
    expect(term.select).toHaveBeenLastCalledWith(4, 1, 9);
  });

  it("shows two handles while active and removes them on clear", () => {
    sel.startAt(...at(8, 0));
    expect(document.querySelectorAll(".selection-handle")).toHaveLength(2);
    sel.clear();
    expect(document.querySelectorAll(".selection-handle")).toHaveLength(0);
    expect(term.clearSelection).toHaveBeenCalled();
    expect(sel.isActive()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("selectScreen() selects every visible row", () => {
    sel.selectScreen();
    expect(term.select).toHaveBeenLastCalledWith(0, 0, 80);
  });

  it("getText() returns xterm's selection", () => {
    sel.startAt(...at(8, 0));
    expect(sel.getText()).toBe("selected text");
  });

  it("finds words by cell, not string index, after wide characters", () => {
    // "日本 /path": 日 = cols 0-1, 本 = cols 2-3, space col 4, /path cols 5-9
    term = makeTerm([[["日", 2], ["本", 2], " ", "/", "p", "a", "t", "h"]]);
    const { container, screen } = makeDom();
    sel = createTouchSelection({ term, container, getScreen: () => screen });
    sel.startAt(...at(6, 0));
    expect(term.select).toHaveBeenLastCalledWith(5, 0, 5);
    sel.startAt(...at(1, 0)); // second half of 日 → the CJK word
    expect(term.select).toHaveBeenLastCalledWith(0, 0, 4);
  });

  it("keeps the opposite end fixed when a handle is dragged past it", () => {
    sel.startAt(...at(10, 1)); // "here" = 9..12 on row 1
    const [hx, hy] = at(9, 1);
    sel.grab("start", hx, hy);
    sel.dragTo(...at(15, 1), "start"); // past the end
    sel.dragTo(...at(16, 1), "start"); // keep going
    expect(term.select).toHaveBeenLastCalledWith(12, 1, 5); // 12..16
  });

  it("drags from where the handle was grabbed (no jump to the finger row)", () => {
    sel.startAt(...at(10, 1)); // end handle at col 12, row 1
    // grab the grip hanging below the end cell (row 2)
    sel.grab("end", 12 * CELL_W + 5, 2 * CELL_H + 6);
    sel.dragTo(14 * CELL_W + 5, 2 * CELL_H + 6, "end"); // 2 cols right
    expect(term.select).toHaveBeenLastCalledWith(9, 1, 6); // 9..14, row 1
  });

  it("clears the selection when output changes the selected text", () => {
    sel.startAt(...at(8, 0));
    term.emitWrite(); // unrelated redraw: same text
    expect(sel.isActive()).toBe(true);
    term.selectionText = "something else";
    term.emitWrite();
    expect(sel.isActive()).toBe(false);
  });

  it("deactivates when xterm drops the selection (e.g. typing)", () => {
    sel.startAt(...at(8, 0));
    term.clearSelection();
    expect(sel.isActive()).toBe(false);
    expect(document.querySelectorAll(".selection-handle")).toHaveLength(0);
  });
});
