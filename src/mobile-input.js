/**
 * Mobile keyboard (IME) handling for xterm's hidden textarea.
 * Tested with @xterm/xterm@5.5.0 — re-verify on every xterm upgrade.
 *
 * xterm assumes keyboards only append: a composition is taken to start at
 * the end of the textarea, and replaced text never produces backspaces. So
 * autocorrect undo, suggestion taps on an earlier word, or editing after
 * moving the cursor send garbage. Instead, the textarea is treated as a
 * mirror of the current terminal line: after every IME change we diff what
 * was last sent against the textarea and send backspaces + the new tail.
 */

/**
 * Kept before the line in the textarea. SwiftKey ignores `autocapitalize`
 * and capitalizes an empty field or text after ". ", "? ", "! "; mid-sentence
 * context like ", " keeps it lowercase.
 */
export const CONTEXT_PREFIX = ", ";

const DEL = "\x7f";
const MAX_CONTEXT_LENGTH = 512;
const SENTENCE_END_RE = /[.!?]\s+$/;
const COMPOSITION_KEYCODE = 229;
const MODIFIER_KEYCODES = new Set([16, 17, 18]);
const PASTE_INPUT_TYPES = new Set(["insertFromPaste", "insertFromDrop"]);
// Control characters and DEL: input that edits or moves outside the textarea
const CONTROL_DATA_RE = /[\x00-\x1f\x7f]/;

/**
 * Edit that turns `oldValue` into `newValue` for a terminal whose cursor sits
 * at the end: backspace to the common prefix, then type the new tail.
 * Works on code points so an emoji is one backspace, never half a pair.
 */
export function computeEdit(oldValue, newValue) {
  const oldChars = Array.from(oldValue);
  const newChars = Array.from(newValue);
  let common = 0;
  const max = Math.min(oldChars.length, newChars.length);
  while (common < max && oldChars[common] === newChars[common]) common++;
  return {
    deleteCount: oldChars.length - common,
    insert: newChars.slice(common).join(""),
  };
}

function hasXtermInternals(term, core, compHelper) {
  return (
    typeof term.onData === "function" &&
    core &&
    compHelper &&
    typeof core._inputEvent === "function" &&
    "_keyPressHandled" in core &&
    typeof compHelper.keydown === "function" &&
    typeof compHelper.compositionend === "function" &&
    "_isComposing" in compHelper &&
    "_coreService" in compHelper &&
    "_textarea" in compHelper &&
    "_compositionView" in compHelper
  );
}

/**
 * @param {import("@xterm/xterm").Terminal} term
 * @returns {{ resetContext: () => void, flush: () => void }}
 *   flush(): send pending keyboard text now, including a word still being
 *   composed (call before sending a toolbar key).
 *   resetContext(): start a fresh line context after input that may move
 *   the cursor (toolbar keys). Data xterm sends itself is handled internally.
 */
export function setupMobileInput(term) {
  const core = term._core;
  const compHelper = core?._compositionHelper;
  if (!hasXtermInternals(term, core, compHelper)) {
    console.error("mobile-input: xterm internals changed; patch not applied");
    return { resetContext() {}, flush() {} };
  }

  const textarea = compHelper._textarea;
  let synced = ""; // textarea value the terminal line currently reflects
  let syncTimer = null;
  let resetPending = false;
  let sending = false;
  // Printable key xterm just sent from keypress; the browser echoes it into
  // the textarea afterwards (and the IME may rewrite the word meanwhile)
  let keypressData = null;

  function send(data) {
    sending = true;
    try {
      compHelper._coreService.triggerDataEvent(data, true);
    } finally {
      sending = false;
    }
  }

  function clearSyncTimer() {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  function writeContext() {
    resetPending = false;
    textarea.value = CONTEXT_PREFIX;
    textarea.setSelectionRange(CONTEXT_PREFIX.length, CONTEXT_PREFIX.length);
    synced = CONTEXT_PREFIX;
  }

  function needsReset(value) {
    return (
      resetPending ||
      !value.startsWith(CONTEXT_PREFIX) ||
      SENTENCE_END_RE.test(value) ||
      value.includes("\n") ||
      value.length > MAX_CONTEXT_LENGTH
    );
  }

  function endComposition() {
    compHelper._isComposing = false;
    compHelper._compositionView.classList.remove("active");
  }

  /** Send the edit that turns `from` (what the terminal shows) into `to`. */
  function applyEdit(from, to) {
    const { deleteCount, insert } = computeEdit(from, to);
    synced = to; // before sending: send() re-enters via onData
    if (deleteCount > 0) send(DEL.repeat(deleteCount));
    if (insert) send(insert.replace(/\n/g, "\r"));
  }

  function maybeReset() {
    if (!compHelper._isComposing && needsReset(textarea.value)) writeContext();
  }

  /**
   * Mirror the textarea onto the terminal line. Skipped mid-composition
   * unless forced (toolbar key while a word is still being composed).
   */
  function sync(force = false) {
    clearSyncTimer();
    if (compHelper._isComposing && !force) return;
    if (textarea.value !== synced) applyEdit(synced, textarea.value);
    maybeReset();
  }

  function scheduleSync() {
    if (syncTimer === null) syncTimer = setTimeout(sync, 0);
  }

  function resetContext() {
    if (compHelper._isComposing) {
      resetPending = true; // applied by sync() after compositionend
      return;
    }
    if (syncTimer !== null) sync(); // never drop input not yet sent
    writeContext();
  }

  function onInput(ev) {
    if (PASTE_INPUT_TYPES.has(ev.inputType)) {
      // xterm's paste handler already sent the text (and cleared the value)
      clearSyncTimer();
      if (!compHelper._isComposing) writeContext();
      return;
    }
    if (keypressData !== null && core._keyPressHandled) {
      // Terminal = synced + the key xterm sent; usually this is a no-op echo
      const from = synced + keypressData;
      keypressData = null;
      clearSyncTimer();
      if (textarea.value !== from) applyEdit(from, textarea.value);
      else synced = from;
      maybeReset();
      return;
    }
    scheduleSync();
  }

  function onXtermData(data) {
    if (sending) return;
    if (CONTROL_DATA_RE.test(data)) {
      // Keys xterm handled itself (Enter, Backspace, arrows, Ctrl+…) or
      // reports: the textarea no longer mirrors the line
      keypressData = null;
      resetContext();
      return;
    }
    keypressData = data;
  }

  compHelper.keydown = function (ev) {
    keypressData = null; // a previous key's echo never came
    if (this._isComposing) {
      if (
        ev.keyCode === COMPOSITION_KEYCODE ||
        MODIFIER_KEYCODES.has(ev.keyCode)
      ) {
        return false;
      }
      // A real key (e.g. Enter) mid-composition: commit the word first
      endComposition();
    }
    if (ev.keyCode === COMPOSITION_KEYCODE) {
      scheduleSync(); // the change arrives as an input event
      return false;
    }
    // Flush before xterm handles the key — it clears the textarea on Enter
    sync();
    return true;
  };

  compHelper.compositionend = function () {
    endComposition();
    scheduleSync(); // the textarea updates after compositionend in Chromium
  };

  // All textarea insertions go through sync(); xterm forwarding insertText
  // as well would double them.
  core._inputEvent = () => false;

  term.onData(onXtermData);
  textarea.addEventListener("input", onInput);
  // Paste with nothing inserted (e.g. an image) still leaves the value
  // cleared by xterm — restore the context once the paste settled
  textarea.addEventListener("paste", () => setTimeout(maybeReset, 0));
  textarea.addEventListener("focus", maybeReset);

  writeContext();

  return { flush: () => sync(true), resetContext };
}
