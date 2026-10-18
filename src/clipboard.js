/**
 * Clipboard access that also works over plain HTTP.
 *
 * The async Clipboard API only exists in secure contexts (HTTPS or
 * localhost). TmuxWeb is usually reached at http://<tailscale-ip>:3000, so
 * copying falls back to the legacy execCommand("copy") on a temporary,
 * selected textarea — still allowed in response to a user tap.
 */

function copyWithExecCommand(text) {
  const previousFocus = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off-screen but focusable; readonly keeps the mobile keyboard closed
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch (err) {
    console.error("execCommand copy failed:", err);
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus?.();
  }
}

/** Copy text; resolves true on success. Call from a tap handler. */
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error("Clipboard API copy failed, falling back:", err);
    }
  }
  const ok = copyWithExecCommand(text);
  if (!ok) console.error("Copy failed: no clipboard method available");
  return ok;
}

/**
 * Read clipboard text, or null when the page may not (plain HTTP, denied
 * permission) — the caller then offers a manual paste box instead.
 */
export async function readClipboard() {
  if (!window.isSecureContext || !navigator.clipboard?.readText) return null;
  try {
    return await navigator.clipboard.readText();
  } catch (err) {
    console.error("Clipboard read refused:", err);
    return null;
  }
}
