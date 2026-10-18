/**
 * Manual paste box. Over plain HTTP a page may not read the clipboard, but
 * the phone's own long-press → Paste works in a visible text field. The
 * pasted text is then sent to the terminal as one paste.
 */

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {(text: string) => void} opts.onSend
 */
export function openPasteBox({ container, onSend }) {
  container.querySelector(".paste-box")?.remove();

  const box = document.createElement("div");
  box.className = "paste-box";

  const hint = document.createElement("div");
  hint.className = "paste-box-hint";
  hint.textContent = "Long-press below and choose Paste, then Send";

  const input = document.createElement("textarea");
  input.className = "paste-box-input";
  input.rows = 4;
  for (const [attr, value] of [
    ["autocapitalize", "none"],
    ["autocorrect", "off"],
    ["autocomplete", "off"],
    ["spellcheck", "false"],
  ]) {
    input.setAttribute(attr, value);
  }

  const actions = document.createElement("div");
  actions.className = "paste-box-actions";

  const close = () => box.remove();
  const addButton = (label, onTap, extraClass = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `paste-box-btn ${extraClass}`.trim();
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onTap();
    });
    actions.appendChild(btn);
  };
  addButton("Cancel", close);
  addButton(
    "Send",
    () => {
      const text = input.value;
      close();
      if (text) onSend(text);
    },
    "paste-box-send",
  );

  box.append(hint, input, actions);
  container.appendChild(box);
  input.focus();
}
