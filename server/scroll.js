/**
 * Scroll a tmux client's pane by an exact number of lines.
 *
 * Mouse-wheel escape codes would go through tmux's default binding, which
 * scrolls 5 lines per event in copy mode — far too coarse for touch. Instead
 * this drives copy mode directly (`send-keys -X -N <n> scroll-up/down`), and
 * only forwards wheel events to apps that handle the mouse themselves.
 */

// Most mouse-aware TUIs (vim, less, …) scroll ~3 lines per wheel event
const APP_LINES_PER_WHEEL = 3;
const WHEEL_UP = 64;
const WHEEL_DOWN = 65;
// One merged tmux call never scrolls more than this (flood protection)
const MAX_PENDING_LINES = 1000;
const SCROLLABLE_MODES = new Set(["copy-mode", "view-mode"]);

// Tab-separated: pane_mode is empty outside a mode, so spaces won't do
export const CLIENT_FORMAT = [
  "#{client_tty}",
  "#{pane_id}",
  "#{mouse_any_flag}",
  "#{pane_in_mode}",
  "#{pane_mode}",
  "#{pane_left}",
  "#{pane_top}",
  "#{pane_width}",
  "#{pane_height}",
  "#{status}",
  "#{status-position}",
].join("\t");

const clamp = (v, max) => Math.max(-max, Math.min(max, v));

/** Rows the status bar takes above the window ("on" = 1, "2".."5" = n). */
function statusRowsAbove(status, position) {
  if (position !== "top" || status === "off") return 0;
  return status === "on" ? 1 : Number.parseInt(status, 10) || 0;
}

function parseClientLine(line) {
  const [tty, paneId, mouse, inMode, mode, left, top, width, height] =
    line.split("\t");
  const [status, position] = line.split("\t").slice(9);
  return {
    tty,
    paneId,
    mouseAware: mouse === "1",
    inMode: inMode === "1",
    mode,
    // 1-based SGR mouse coordinates of the pane's centre on the client
    centerX: Number(left) + Math.floor(Number(width) / 2) + 1,
    centerY:
      statusRowsAbove(status, position) +
      Number(top) +
      Math.floor(Number(height) / 2) +
      1,
  };
}

/**
 * @param {object} deps
 * @param {() => string | null} deps.getTty - tty of this connection's client
 * @param {(args: string[]) => Promise<string>} deps.runTmux
 * @param {(data: string) => void} deps.writeInput - write to the client PTY
 * @param {() => boolean} [deps.isClosed]
 * @returns {{ add: (lines: number) => void }} positive = toward newer output
 */
export function createScroller({
  getTty,
  runTmux,
  writeInput,
  isClosed = () => false,
}) {
  let pending = 0;
  let busy = false;
  let appRemainder = 0;
  let appPane = null;

  /**
   * The client's current pane. `display-message -c <tty>` does NOT target the
   * client's pane (it falls back to the caller's/most recent one), so read
   * every client's pane from list-clients and pick ours by tty.
   */
  async function findClient(tty) {
    const out = await runTmux(["list-clients", "-F", CLIENT_FORMAT]);
    const line = out.split("\n").find((l) => l.split("\t")[0] === tty);
    return line ? parseClientLine(line) : null;
  }

  // tmux routes mouse events by position, so aim at the pane's centre:
  // row 1 may be a top status bar (wheel there switches windows) and the
  // active pane need not be the top-left one.
  function forwardWheelToApp(client, lines) {
    if (client.paneId !== appPane) {
      appPane = client.paneId;
      appRemainder = 0;
    }
    appRemainder += lines;
    const events = Math.trunc(appRemainder / APP_LINES_PER_WHEEL);
    if (events === 0) return;
    appRemainder -= events * APP_LINES_PER_WHEEL;
    const button = events > 0 ? WHEEL_DOWN : WHEEL_UP;
    const event = `\x1b[<${button};${client.centerX};${client.centerY}M`;
    writeInput(event.repeat(Math.abs(events)));
  }

  async function scrollCopyMode(client, lines) {
    appRemainder = 0;
    if (!client.inMode && lines > 0) return; // already live at the bottom
    const scroll = [
      "send-keys",
      "-t",
      client.paneId,
      "-X",
      "-N",
      String(Math.abs(lines)),
      lines < 0 ? "scroll-up" : "scroll-down",
    ];
    // -e: leave copy mode automatically when scrolled back to the bottom
    await runTmux(
      client.inMode
        ? scroll
        : ["copy-mode", "-e", "-t", client.paneId, ";", ...scroll],
    );
  }

  async function scrollOnce(lines) {
    const tty = getTty();
    if (!tty) return;
    const client = await findClient(tty);
    if (!client || isClosed()) return; // not attached (yet / any more)

    // Same routing as tmux's default WheelUpPane binding
    if (!client.inMode && client.mouseAware) {
      forwardWheelToApp(client, lines);
      return;
    }
    if (client.inMode && !SCROLLABLE_MODES.has(client.mode)) return;
    await scrollCopyMode(client, lines);
  }

  /** One tmux round trip at a time; lines requested meanwhile are merged. */
  async function drain() {
    busy = true;
    try {
      while (pending !== 0 && !isClosed()) {
        const lines = pending;
        pending = 0;
        try {
          await scrollOnce(lines);
        } catch (err) {
          console.error("tmux scroll failed:", err.message);
        }
      }
      pending = 0;
    } finally {
      busy = false;
    }
  }

  return {
    add(lines) {
      if (isClosed()) return;
      pending = clamp(pending + lines, MAX_PENDING_LINES);
      if (!busy) drain();
    },
  };
}
