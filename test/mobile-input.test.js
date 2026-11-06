// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setupMobileInput,
  computeEdit,
  keepTrailingSpace,
  CONTEXT_PREFIX,
  SPACE_GUARD_MS,
} from "../src/mobile-input.js";

/** Minimal stand-in for the xterm internals the module patches. */
function makeTerm() {
  const textarea = document.createElement("textarea");
  document.body.replaceChildren(textarea);
  const sent = [];
  const dataListeners = [];
  const compHelper = {
    _textarea: textarea,
    _compositionView: document.createElement("div"),
    _isComposing: false,
    _coreService: {
      triggerDataEvent: (data) => {
        sent.push(data);
        dataListeners.forEach((cb) => cb(data));
      },
    },
    _handleAnyTextareaChanges() {},
    keydown: () => true,
    compositionstart() {
      this._isComposing = true;
    },
    compositionend() {},
  };
  const core = {
    _compositionHelper: compHelper,
    _inputEvent: () => true,
    _keyPressHandled: false,
  };
  const term = { _core: core, onData: (cb) => dataListeners.push(cb) };
  /** Data xterm itself sends (key handlers, paste, reports). */
  const xtermSends = (data) => compHelper._coreService.triggerDataEvent(data);
  return { term, xtermSends, core, textarea, compHelper, sent };
}

/** Replay sent data onto a line: DEL removes a char, the rest appends. */
function lineFrom(sent) {
  const line = [];
  for (const ch of sent.join("")) {
    if (ch === "\x7f") line.pop();
    else line.push(ch);
  }
  return line.join("");
}

describe("computeEdit", () => {
  it("returns backspaces back to the common prefix plus the new tail", () => {
    expect(computeEdit(", teh", ", the")).toEqual({
      deleteCount: 2,
      insert: "he",
    });
    expect(computeEdit(", ab", ", ab")).toEqual({ deleteCount: 0, insert: "" });
    expect(computeEdit(", ab", ", abc")).toEqual({
      deleteCount: 0,
      insert: "c",
    });
  });
});

describe("keepTrailingSpace", () => {
  it("puts back a space swapped for punctuation", () => {
    expect(keepTrailingSpace(", cd ", ", cd.")).toBe(", cd .");
    expect(keepTrailingSpace(", cd ", ", cd?!")).toBe(", cd ?!");
  });

  it("drops the keyboard's auto-space after the punctuation", () => {
    expect(keepTrailingSpace(", cd ", ", cd. ")).toBe(", cd .");
  });

  it("leaves every other edit alone", () => {
    expect(keepTrailingSpace(", cd", ", cd.")).toBeNull(); // no space
    expect(keepTrailingSpace(", cd ", ", cd .")).toBeNull(); // space kept
    expect(keepTrailingSpace(", cd ", ", cdx")).toBeNull(); // a letter
    expect(keepTrailingSpace(", cd ", ", cd")).toBeNull(); // only deleted
    expect(keepTrailingSpace(", cd ", ", cd. x")).toBeNull(); // more text
    expect(keepTrailingSpace(", cd ", ", ls.")).toBeNull(); // other word
  });
});

describe("setupMobileInput", () => {
  let env;
  let mobile;

  beforeEach(() => {
    vi.useFakeTimers();
    env = makeTerm();
    mobile = setupMobileInput(env.term);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** IME edit outside a composition (commitText / deleteSurroundingText). */
  function edit(value, inputType = "insertText") {
    env.textarea.value = value;
    env.textarea.setSelectionRange(value.length, value.length);
    env.textarea.dispatchEvent(new InputEvent("input", { inputType }));
    vi.advanceTimersByTime(5);
  }

  /** A full composition: start, intermediate values, then the final value. */
  function compose(values) {
    env.compHelper.compositionstart();
    for (const value of values) {
      env.textarea.value = value;
      env.textarea.dispatchEvent(
        new InputEvent("input", { inputType: "insertCompositionText" }),
      );
    }
    env.compHelper.compositionend();
    vi.advanceTimersByTime(5);
  }

  const P = CONTEXT_PREFIX;

  it("seeds the textarea so the keyboard never sees an empty field", () => {
    expect(env.textarea.value).toBe(P);
    expect(env.textarea.selectionStart).toBe(P.length);
    expect(P).not.toMatch(/[.!?]\s*$/);
  });

  it("sends a composed word once, when the composition ends", () => {
    env.compHelper.compositionstart();
    env.textarea.value = P + "gi";
    env.textarea.dispatchEvent(new InputEvent("input"));
    vi.advanceTimersByTime(50);
    expect(env.sent).toEqual([]); // nothing mid-composition

    env.textarea.value = P + "git";
    env.compHelper.compositionend();
    vi.advanceTimersByTime(5);
    expect(lineFrom(env.sent)).toBe("git");
  });

  it("autocorrect inside the composition sends the corrected word", () => {
    compose([P + "t", P + "te", P + "teh", P + "the"]);
    edit(P + "the ");
    expect(lineFrom(env.sent)).toBe("the ");
  });

  it("undoing an autocorrect from the suggestion bar replaces the word", () => {
    compose([P + "the"]);
    edit(P + "the ");
    // Suggestion tap: no key events, delete then insert
    edit(P, "deleteContentBackward");
    edit(P + "teh ");
    expect(lineFrom(env.sent)).toBe("teh ");
  });

  it("keeps previous words as context so they can be replaced later", () => {
    compose([P + "git"]);
    edit(P + "git ");
    vi.advanceTimersByTime(500);
    expect(env.textarea.value).toBe(P + "git ");
  });

  it("re-composing an earlier word (backspace into it) applies the fix", () => {
    compose([P + "git"]);
    edit(P + "git ");
    compose([P + "git comit"]);
    edit(P + "git comit"); // no-op, settles
    // SwiftKey re-opens "comit" and replaces it with a suggestion
    compose([P + "git comit", P + "git commit"]);
    expect(lineFrom(env.sent)).toBe("git commit");
  });

  describe("smart punctuation (SwiftKey eats the space before '.')", () => {
    it("keeps the space: cd .. stays cd ..", () => {
      compose([P + "cd"]);
      edit(P + "cd ");
      edit(P + "cd."); // the space swapped for "."
      edit(P + "cd .."); // the keyboard re-read the field
      expect(lineFrom(env.sent)).toBe("cd ..");
    });

    it("never sends a DEL for the swap", () => {
      compose([P + "cd"]);
      edit(P + "cd ");
      env.sent.length = 0;
      edit(P + "cd.");
      expect(env.sent).toEqual(["."]);
      expect(env.textarea.value).toBe(P + "cd .");
      expect(env.textarea.selectionStart).toBe((P + "cd .").length);
    });

    it("handles the swap arriving as delete-then-insert", () => {
      compose([P + "cd"]);
      edit(P + "cd ");
      edit(P + "cd", "deleteContentBackward");
      edit(P + "cd. "); // with the keyboard's auto-space
      vi.advanceTimersByTime(SPACE_GUARD_MS);
      expect(lineFrom(env.sent)).toBe("cd .");
      expect(env.textarea.value).toBe(P + "cd .");
    });

    it("still sends a real backspace on the space after a short wait", () => {
      compose([P + "cd"]);
      edit(P + "cd ");
      edit(P + "cd", "deleteContentBackward");
      expect(lineFrom(env.sent)).toBe("cd "); // waiting for punctuation
      vi.advanceTimersByTime(SPACE_GUARD_MS);
      expect(lineFrom(env.sent)).toBe("cd");
    });

    it("a key pressed meanwhile sends the backspace first (order kept)", () => {
      compose([P + "cd"]);
      edit(P + "cd ");
      edit(P + "cd", "deleteContentBackward");
      env.compHelper.keydown({ keyCode: 13 }); // Enter
      expect(env.sent.at(-1)).toBe("\x7f");
    });

    it("focus while a backspace is held back still sends it", () => {
      edit(P.slice(0, -1), "deleteContentBackward"); // eats the prefix
      env.textarea.dispatchEvent(new FocusEvent("focus"));
      expect(env.sent).toEqual(["\x7f"]);
      expect(env.textarea.value).toBe(P);
    });

    it("typing '.' at the start of a line deletes nothing", () => {
      edit(",."); // the prefix's space swapped for "."
      expect(env.sent).toEqual(["."]);
    });

    it("applies after a suggestion's auto-space too", () => {
      compose([P + "word"]);
      edit(P + "word "); // auto-space
      edit(P + "word", "deleteContentBackward");
      edit(P + "word. ");
      vi.advanceTimersByTime(SPACE_GUARD_MS);
      expect(lineFrom(env.sent)).toBe("word .");
    });
  });

  it("edits in the middle (cursor moved with the space bar) stay correct", () => {
    compose([P + "abc"]);
    env.textarea.value = P + "aXbc";
    env.textarea.setSelectionRange(P.length + 2, P.length + 2);
    env.textarea.dispatchEvent(new InputEvent("input"));
    vi.advanceTimersByTime(5);
    expect(lineFrom(env.sent)).toBe("aXbc");
  });

  it("backspace that eats the prefix sends one DEL and restores it", () => {
    edit(P.slice(0, -1), "deleteContentBackward");
    vi.advanceTimersByTime(SPACE_GUARD_MS);
    expect(env.sent).toEqual(["\x7f"]);
    expect(env.textarea.value).toBe(P);
  });

  it("resets after a sentence end so the next word stays lowercase", () => {
    compose([P + "cd"]);
    edit(P + "cd .. ");
    expect(lineFrom(env.sent)).toBe("cd .. ");
    expect(env.textarea.value).toBe(P);
  });

  it("turns an IME-inserted newline into Enter", () => {
    edit(P + "ls\n", "insertLineBreak");
    expect(env.sent.join("")).toBe("ls\r");
  });

  it("absorbs text xterm already sent from a keypress (desktop A-Z, space)", () => {
    env.core._keyPressHandled = true;
    env.xtermSends("H"); // xterm sent "H" from keypress
    edit(P + "H"); // ...and the browser inserted it too
    env.core._keyPressHandled = false;
    expect(env.sent).toEqual(["H"]);
    edit(P + "Hi"); // later IME edits diff from the absorbed state
    expect(lineFrom(env.sent)).toBe("Hi");
  });

  it("does not absorb an IME correction that lands during a keypress", () => {
    compose([P + "helo"]);
    env.core._keyPressHandled = true;
    env.xtermSends(" "); // hardware-style space from keypress
    edit(P + "hello "); // IME autocorrects in the same key cycle
    env.core._keyPressHandled = false;
    vi.advanceTimersByTime(5);
    expect(lineFrom(env.sent)).toBe("hello ");
  });

  it("paste: xterm sends it, the textarea copy is not forwarded again", () => {
    compose([P + "ls"]);
    env.xtermSends("foo"); // xterm's paste handler
    env.textarea.value = ""; // ...which clears the textarea
    env.textarea.dispatchEvent(new Event("paste"));
    edit("foo", "insertFromPaste"); // browser default action
    vi.advanceTimersByTime(5);
    expect(lineFrom(env.sent)).toBe("lsfoo");
    expect(env.textarea.value).toBe(P);
  });

  it("paste with no textarea insertion still restores the context", () => {
    env.xtermSends("img");
    env.textarea.value = "";
    env.textarea.dispatchEvent(new Event("paste"));
    vi.advanceTimersByTime(5);
    edit(P + "x");
    expect(lineFrom(env.sent)).toBe("imgx");
  });

  it("hardware Backspace (sent by xterm) resets so later edits stay correct", () => {
    compose([P + "abc"]);
    env.xtermSends("\x7f"); // xterm handled Backspace; textarea untouched
    edit(P + "x");
    expect(lineFrom(env.sent)).toBe("abx");
  });

  it("a reset never drops input that has not been synced yet", () => {
    env.textarea.value = P + "ls";
    env.textarea.dispatchEvent(new InputEvent("input"));
    env.xtermSends("\x1b[I"); // e.g. a focus report lands in the gap
    expect(env.sent.join("")).toContain("ls");
  });

  it("counts an emoji as one character when deleting", () => {
    edit(P + "a😀");
    edit(P + "a", "deleteContentBackward");
    expect(lineFrom(env.sent)).toBe("a");
    expect(env.sent.at(-1)).toBe("\x7f");
  });

  it("disables xterm's own insertText forwarding (no doubled input)", () => {
    expect(env.core._inputEvent(new InputEvent("input"))).toBe(false);
  });

  describe("non-IME keys (Enter, Tab, arrows)", () => {
    it("flushes pending text before the key is processed", () => {
      env.textarea.value = P + "ls";
      env.textarea.dispatchEvent(new InputEvent("input"));
      // Enter arrives before the scheduled sync ran
      expect(env.compHelper.keydown({ keyCode: 13 })).toBe(true);
      expect(env.sent.join("")).toBe("ls");
    });

    it("commits an in-progress composition before Enter", () => {
      env.compHelper.compositionstart();
      env.textarea.value = P + "ls";
      expect(env.compHelper.keydown({ keyCode: 13 })).toBe(true);
      expect(env.sent.join("")).toBe("ls");
      expect(env.compHelper._isComposing).toBe(false);
    });

    it("keeps composing on keyCode 229 and modifier keys", () => {
      env.compHelper.compositionstart();
      expect(env.compHelper.keydown({ keyCode: 229 })).toBe(false);
      expect(env.compHelper.keydown({ keyCode: 16 })).toBe(false);
      expect(env.compHelper._isComposing).toBe(true);
    });

    it("resetContext() after xterm clears the textarea sends no DELs", () => {
      compose([P + "ls"]);
      env.compHelper.keydown({ keyCode: 13 });
      env.textarea.value = ""; // xterm clears it on Enter
      mobile.resetContext();
      vi.advanceTimersByTime(50);
      expect(lineFrom(env.sent)).toBe("ls");
      expect(env.textarea.value).toBe(P);
    });

    it("flush() mid-composition sends the word before the toolbar key", () => {
      env.compHelper.compositionstart();
      env.textarea.value = P + "ls";
      mobile.flush();
      env.xtermSends("\r"); // toolbar Enter (sent after flush)
      mobile.resetContext();
      env.compHelper.compositionend(); // IME commits the same word later
      vi.advanceTimersByTime(5);
      expect(env.sent.join("")).toBe("ls\r");
      expect(env.textarea.value).toBe(P);
    });

    it("flush() sends pending text before a toolbar key", () => {
      env.textarea.value = P + "ech";
      env.textarea.dispatchEvent(new InputEvent("input"));
      mobile.flush();
      expect(env.sent.join("")).toBe("ech");
    });

    it("defers a reset requested mid-composition until it ends", () => {
      env.compHelper.compositionstart();
      env.textarea.value = P + "wor";
      mobile.resetContext();
      expect(env.textarea.value).toBe(P + "wor");
      env.textarea.value = P + "word";
      env.compHelper.compositionend();
      vi.advanceTimersByTime(5);
      expect(lineFrom(env.sent)).toBe("word");
      expect(env.textarea.value).toBe(P);
    });
  });

  it("does nothing when xterm internals are missing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = setupMobileInput({ _core: {} });
    expect(() => result.resetContext()).not.toThrow();
    expect(() => result.flush()).not.toThrow();
  });
});
