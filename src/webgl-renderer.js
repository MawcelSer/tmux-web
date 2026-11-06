import { WebglAddon } from "@xterm/addon-webgl";

/**
 * Draw the terminal with WebGL. The default DOM renderer rebuilds every row
 * on each scroll step, which stutters on phones.
 *
 * Falls back to the DOM renderer when WebGL fails, or when the GPU context
 * is lost (mobile browsers drop it in background tabs); restore() brings
 * WebGL back, e.g. once the page is visible. A context can fail to come
 * back right after a tab switch, so a few failures are retried later.
 *
 * @param {import("@xterm/xterm").Terminal} term
 * @param {object} [opts]
 * @param {() => WebglAddon} [opts.createAddon]
 * @returns {{ restore: () => void, isActive: () => boolean }}
 */
// Failed loads in a row before giving up (WebGL simply isn't available)
const MAX_LOAD_FAILURES = 3;

export function setupWebglRenderer(
  term,
  { createAddon = () => new WebglAddon() } = {},
) {
  let addon = null;
  let failures = 0;

  function load() {
    if (addon || failures >= MAX_LOAD_FAILURES) return;
    let next = null;
    try {
      next = createAddon();
      next.onContextLoss(() => {
        next.dispose(); // xterm switches back to the DOM renderer
        if (addon === next) addon = null;
      });
      term.loadAddon(next);
      addon = next;
      failures = 0;
    } catch (err) {
      failures += 1;
      next?.dispose(); // free whatever the half-done load created
      console.error("WebGL renderer unavailable, using DOM renderer:", err);
    }
  }

  load();
  return { restore: load, isActive: () => addon !== null };
}
