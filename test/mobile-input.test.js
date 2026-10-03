// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupMobileInput, CONTEXT_PREFIX } from "../src/mobile-input.js";

/** Minimal stand-in for xterm internals touched by the patch. */
function makeTerm() {
  const textarea = document.createElement("textarea");
  document.body.replaceChildren(textarea);
  const sent = [];
  const compHelper = {
    _textarea: textarea,
    _isComposing: false,
    _coreService: { triggerDataEvent: (data) => sent.push(data) },
    _handleAnyTextareaChanges() {},
  };
  return {
    term: { _core: { _compositionHelper: compHelper } },
    textarea,
    compHelper,
    sent,
  };
}

/** Simulate an IME edit: keydown(229) snapshots, then the value changes. */
function imeEdit(compHelper, newValue) {
  compHelper._handleAnyTextareaChanges();
  compHelper._textarea.value = newValue;
  compHelper._textarea.setSelectionRange(newValue.length, newValue.length);
}

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

  it("seeds the textarea so the keyboard never sees an empty field", () => {
    expect(env.textarea.value).toBe(CONTEXT_PREFIX);
    expect(env.textarea.selectionStart).toBe(CONTEXT_PREFIX.length);
    expect(CONTEXT_PREFIX).not.toMatch(/[.!?]\s*$/); // not a sentence end
  });

  it("sends only the typed text, not the prefix", () => {
    imeEdit(env.compHelper, CONTEXT_PREFIX + "l");
    vi.advanceTimersByTime(20);
    imeEdit(env.compHelper, CONTEXT_PREFIX + "ls");
    vi.advanceTimersByTime(20);
    expect(env.sent.join("")).toBe("ls");
  });

  it("restores the prefix after a word ends, so the next word is not capitalized", () => {
    imeEdit(env.compHelper, CONTEXT_PREFIX + "cd .. ");
    vi.advanceTimersByTime(100);
    expect(env.sent.join("")).toBe("cd .. ");
    expect(env.textarea.value).toBe(CONTEXT_PREFIX);
  });

  it("leaves a word in progress alone (keeps SwiftKey's word context)", () => {
    imeEdit(env.compHelper, CONTEXT_PREFIX + "gi");
    vi.advanceTimersByTime(100);
    expect(env.textarea.value).toBe(CONTEXT_PREFIX + "gi");
  });

  it("backspace that eats the prefix sends one DEL and restores the prefix", () => {
    imeEdit(env.compHelper, CONTEXT_PREFIX.slice(0, -1));
    vi.advanceTimersByTime(100);
    expect(env.sent).toEqual(["\x7f"]);
    expect(env.textarea.value).toBe(CONTEXT_PREFIX);
  });

  it("never resets during a composition", () => {
    env.compHelper._isComposing = true;
    env.textarea.value = CONTEXT_PREFIX + "hello ";
    mobile.resetContext();
    vi.advanceTimersByTime(500);
    expect(env.textarea.value).toBe(CONTEXT_PREFIX + "hello ");

    env.compHelper._isComposing = false;
    vi.advanceTimersByTime(100);
    expect(env.textarea.value).toBe(CONTEXT_PREFIX);
  });

  it("waits for a pending keystroke diff before resetting (no doubled input)", () => {
    // Enter pressed (reset requested) while a keystroke is still debouncing
    env.compHelper._handleAnyTextareaChanges(); // snapshot = prefix
    mobile.resetContext();
    env.textarea.value = CONTEXT_PREFIX + "x";
    vi.advanceTimersByTime(100);
    expect(env.sent).toEqual(["x"]); // diffed against the real snapshot
    expect(env.textarea.value).toBe(CONTEXT_PREFIX);
  });

  it("resetContext() clears a word in progress (e.g. after Enter or Tab)", () => {
    imeEdit(env.compHelper, CONTEXT_PREFIX + "ech");
    vi.advanceTimersByTime(20);
    mobile.resetContext();
    vi.advanceTimersByTime(100);
    expect(env.textarea.value).toBe(CONTEXT_PREFIX);
    expect(env.sent.join("")).toBe("ech");
  });

  it("does nothing when xterm internals are missing", () => {
    const textarea = document.createElement("textarea");
    expect(() => setupMobileInput({ _core: {} })).not.toThrow();
    expect(textarea.value).toBe("");
  });
});
