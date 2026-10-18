/**
 * Floating action bar shown while text is selected: Copy · Paste · Screen · ✕
 * plus a short toast for feedback ("Copied").
 */

const TOAST_MS = 1500;

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {() => void} opts.onCopy
 * @param {() => void} opts.onPaste
 * @param {() => void} opts.onSelectScreen
 * @param {() => void} opts.onClose
 */
export function createSelectionBar({
  container,
  onCopy,
  onPaste,
  onSelectScreen,
  onClose,
}) {
  const bar = document.createElement("div");
  bar.className = "selection-bar";
  bar.hidden = true;

  const addButton = (label, onTap, extraClass = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `selection-bar-btn ${extraClass}`.trim();
    btn.textContent = label;
    // touchstart is cancelled so focus doesn't move (keyboard stays closed).
    // The action runs on touchend: Chrome only counts touchend as a user
    // gesture, and copying to the clipboard requires one. Cancelling
    // touchend also suppresses the ghost click (no double action).
    btn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false },
    );
    btn.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTap();
      },
      { passive: false },
    );
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onTap();
    });
    bar.appendChild(btn);
  };

  addButton("Copy", onCopy, "selection-bar-primary");
  addButton("Paste", onPaste);
  addButton("Screen", onSelectScreen);
  addButton("✕", onClose, "selection-bar-close");

  const toastEl = document.createElement("div");
  toastEl.className = "selection-toast";
  toastEl.hidden = true;

  container.appendChild(bar);
  container.appendChild(toastEl);

  let toastTimer = null;

  return {
    show() {
      bar.hidden = false;
    },
    hide() {
      bar.hidden = true;
    },
    toast(message) {
      toastEl.textContent = message;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, TOAST_MS);
    },
  };
}
