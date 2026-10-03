/**
 * Mobile keyboard (IME) workarounds for xterm's hidden textarea.
 * Tested with @xterm/xterm@5.5.0 — re-verify on every xterm upgrade.
 */

/**
 * Text kept before the cursor in xterm's textarea. Android keyboards
 * (SwiftKey ignores `autocapitalize`) capitalize at the start of an empty
 * field and after ". ", "? ", "! ". Mid-sentence context like ", " keeps the
 * next word lowercase. xterm never clears this textarea itself.
 */
export const CONTEXT_PREFIX = ", ";

const DIFF_DEBOUNCE_MS = 15;
const RESET_RETRY_MS = 30;
const MAX_CONTEXT_LENGTH = 256;

function diffValues(oldValue, newValue) {
  let prefixLen = 0;
  const minLen = Math.min(oldValue.length, newValue.length);
  while (prefixLen < minLen && oldValue[prefixLen] === newValue[prefixLen]) {
    prefixLen++;
  }
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldValue[oldValue.length - 1 - suffixLen] ===
      newValue[newValue.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }
  return {
    deleted: oldValue.substring(prefixLen, oldValue.length - suffixLen),
    added: newValue.substring(prefixLen, newValue.length - suffixLen),
  };
}

/**
 * Patch xterm's _handleAnyTextareaChanges to fix SwiftKey double-fire.
 * See: https://github.com/xtermjs/xterm.js/issues/3600
 *
 * SwiftKey does delete-then-insert for punctuation after auto-space.
 * xterm's _handleAnyTextareaChanges uses newValue.replace(oldValue, '')
 * which fails when delete changes the sequence — replace() returns the
 * ENTIRE textarea as "new" data. Fix: debounce the burst into one diff
 * and use proper prefix/suffix comparison instead of String.replace().
 *
 * @returns {{ isPending: () => boolean }}
 */
function patchSwiftKeyComposition(compHelper, onSettled) {
  let firstOldValue = null;
  let pendingTimer = null;

  compHelper._handleAnyTextareaChanges = function () {
    if (firstOldValue === null) {
      firstOldValue = this._textarea.value;
    }
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const oldValue = firstOldValue;
      firstOldValue = null;

      if (!this._isComposing) {
        const newValue = this._textarea.value;
        if (newValue !== oldValue) {
          const { deleted, added } = diffValues(oldValue, newValue);
          for (let k = 0; k < deleted.length; k++) {
            this._coreService.triggerDataEvent("\x7f", true);
          }
          if (added.length > 0) {
            this._dataAlreadySent = added;
            this._coreService.triggerDataEvent(added, true);
          }
        }
      }
      onSettled();
    }, DIFF_DEBOUNCE_MS);
  };

  return { isPending: () => firstOldValue !== null };
}

function hasXtermInternals(compHelper) {
  return (
    compHelper &&
    typeof compHelper._handleAnyTextareaChanges === "function" &&
    "_isComposing" in compHelper &&
    "_coreService" in compHelper &&
    "_textarea" in compHelper
  );
}

/**
 * Install the SwiftKey patch and keep the textarea's text-before-cursor in a
 * state where keyboards do not auto-capitalize.
 *
 * @param {import("@xterm/xterm").Terminal} term
 * @returns {{ resetContext: () => void }} call resetContext() after input
 *   that bypasses the textarea (Enter, Tab, arrows, toolbar keys)
 */
export function setupMobileInput(term) {
  const compHelper = term._core?._compositionHelper;
  if (!hasXtermInternals(compHelper)) {
    console.error("mobile-input: xterm internals changed; patch not applied");
    return { resetContext() {} };
  }

  const textarea = compHelper._textarea;
  let resetTimer = null;

  function writeContext() {
    textarea.value = CONTEXT_PREFIX;
    textarea.setSelectionRange(CONTEXT_PREFIX.length, CONTEXT_PREFIX.length);
  }

  // Never touch the value mid-composition or while a keystroke diff is
  // pending — that is what caused doubled characters in earlier attempts.
  function canWrite() {
    return !compHelper._isComposing && !patch.isPending();
  }

  function scheduleReset(force) {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      resetTimer = null;
      if (!canWrite()) {
        scheduleReset(force);
        return;
      }
      if (force || needsReset(textarea.value)) writeContext();
    }, RESET_RETRY_MS);
  }

  // Reset at word boundaries (keeps SwiftKey's context for the word being
  // typed), when the prefix was deleted, or when the buffer grows large.
  function needsReset(value) {
    return (
      !value.startsWith(CONTEXT_PREFIX) ||
      /\s$/.test(value) ||
      value.length > MAX_CONTEXT_LENGTH
    );
  }

  const patch = patchSwiftKeyComposition(compHelper, () => {
    if (needsReset(textarea.value)) scheduleReset(false);
  });

  writeContext();
  textarea.addEventListener("focus", () => scheduleReset(false));

  return { resetContext: () => scheduleReset(true) };
}
