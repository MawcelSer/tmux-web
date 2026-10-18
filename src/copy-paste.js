/**
 * Mobile copy & paste: long-press selection + action bar + clipboard.
 */
import { createTouchSelection } from "./touch-selection.js";
import { createSelectionBar } from "./selection-bar.js";
import { openPasteBox } from "./paste-box.js";
import { copyText, readClipboard } from "./clipboard.js";

/**
 * @param {object} opts
 * @param {import("@xterm/xterm").Terminal} opts.term
 * @param {HTMLElement} opts.container - terminal container (handles go here)
 * @param {HTMLElement} opts.overlayHost - outside the container: its capture
 *   phase touch handlers would swallow taps on the bar and paste box
 * @param {(text: string) => void} opts.paste - send text as a paste
 * @returns the touch selection, for the gesture handler
 */
export function setupCopyPaste({ term, container, overlayHost, paste }) {
  // `bar` is created below; onChange only fires after setup
  let bar;
  const selection = createTouchSelection({
    term,
    container,
    getScreen: () => term.element?.querySelector(".xterm-screen"),
    onChange: (active) => (active ? bar.show() : bar.hide()),
  });

  async function onCopy() {
    const text = selection.getText();
    if (!text.trim()) {
      bar.toast("Nothing to copy");
      return;
    }
    const ok = await copyText(text);
    bar.toast(ok ? "Copied" : "Copy failed");
    if (ok) selection.clear();
  }

  async function onPaste() {
    selection.clear();
    const text = await readClipboard();
    if (text) paste(text);
    else openPasteBox({ container: overlayHost, onSend: paste });
  }

  bar = createSelectionBar({
    container: overlayHost,
    onCopy,
    onPaste,
    onSelectScreen: () => selection.selectScreen(),
    onClose: () => selection.clear(),
  });

  // Cell positions are meaningless after a resize
  term.onResize(() => selection.clear());

  return selection;
}
