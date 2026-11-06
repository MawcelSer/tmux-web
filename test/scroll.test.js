import { describe, it, expect, vi } from "vitest";
import {
  createScroller,
  CLIENT_FORMAT,
  CLIENT_CACHE_MS,
  PANE_STATE_FORMAT,
} from "../server/scroll.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** One `tmux list-clients -F CLIENT_FORMAT` line. */
function clientLine({
  tty = "/dev/pts/4",
  pane = "%3",
  mouse = 0,
  inMode = 0,
  mode = "",
  left = 0,
  top = 0,
  width = 80,
  height = 24,
  status = "on",
  position = "bottom",
} = {}) {
  return [
    tty,
    pane,
    mouse,
    inMode,
    mode,
    left,
    top,
    width,
    height,
    status,
    position,
  ].join("\t");
}

/** Pane state printed by the display-message that ends each scroll. */
function paneState({ mouse = 0, inMode = 0, mode = "" } = {}) {
  return `${mouse}\t${inMode}\t${mode}\n`;
}

const readState = (pane = "%3") => [
  ";",
  "display-message",
  "-p",
  "-t",
  pane,
  PANE_STATE_FORMAT,
];

function setup({ client = {}, closed = () => false } = {}) {
  const calls = [];
  let current = clientLine(client);
  let state = paneState({ ...client, inMode: 1, mode: "copy-mode" });
  let clock = 0;
  const runTmux = vi.fn(async (args) => {
    calls.push(args);
    if (args[0] !== "list-clients") return state;
    // another client listed first: ours must be picked by tty
    return `${clientLine({ tty: "/dev/pts/99", pane: "%9", mouse: 1 })}\n${current}\n`;
  });
  const writeInput = vi.fn();
  const scroller = createScroller({
    getTty: () => ("tty" in client ? client.tty : "/dev/pts/4"),
    runTmux,
    writeInput,
    isClosed: closed,
    now: () => clock,
  });
  return {
    scroller,
    runTmux,
    writeInput,
    calls,
    // a changed client is only seen once the cached lookup has expired
    setClient: (c, { expire = true } = {}) => {
      current = clientLine(c);
      if (expire) clock += CLIENT_CACHE_MS;
    },
    setPaneState: (s) => (state = paneState(s)),
    setRawPaneState: (raw) => (state = raw),
    advance: (ms) => (clock += ms),
  };
}

const scrollCalls = (calls) => calls.filter((c) => c[0] !== "list-clients");
const lookups = (calls) => calls.filter((c) => c[0] === "list-clients");
const lineCount = (call) => call[call.indexOf("-N") + 1];

describe("createScroller", () => {
  it("queries clients with a tab-separated format (empty fields survive)", async () => {
    const { scroller, calls } = setup();
    scroller.add(-1);
    await flush();
    expect(calls[0]).toEqual(["list-clients", "-F", CLIENT_FORMAT]);
    expect(CLIENT_FORMAT.split("\t")).toHaveLength(11);
  });

  it("scrolling up enters copy mode and scrolls exactly N lines", async () => {
    const { scroller, calls } = setup();
    scroller.add(-7);
    await flush();
    expect(scrollCalls(calls)[0]).toEqual([
      "copy-mode",
      "-e",
      "-t",
      "%3",
      ";",
      "send-keys",
      "-t",
      "%3",
      "-X",
      "-N",
      "7",
      "scroll-up",
      ...readState(),
    ]);
  });

  it("scrolls down inside copy mode (-e exits at the bottom)", async () => {
    const { scroller, calls } = setup({
      client: { inMode: 1, mode: "copy-mode" },
    });
    scroller.add(4);
    await flush();
    expect(scrollCalls(calls)[0]).toEqual([
      "send-keys",
      "-t",
      "%3",
      "-X",
      "-N",
      "4",
      "scroll-down",
      ...readState(),
    ]);
  });

  it("ignores scrolling down when already live at the bottom", async () => {
    const { scroller, calls } = setup();
    scroller.add(5);
    await flush();
    expect(scrollCalls(calls)).toEqual([]);
  });

  it("leaves other pane modes (choose-tree…) alone", async () => {
    const { scroller, calls, writeInput } = setup({
      client: { inMode: 1, mode: "tree-mode" },
    });
    scroller.add(-5);
    await flush();
    expect(scrollCalls(calls)).toEqual([]);
    expect(writeInput).not.toHaveBeenCalled();
  });

  describe("mouse-aware apps", () => {
    it("forwards wheel events (1 per 3 lines) at the pane's centre", async () => {
      const { scroller, writeInput } = setup({
        client: { mouse: 1, left: 0, top: 0, width: 80, height: 24 },
      });
      scroller.add(-7); // 2 events, 1 line carried
      await flush();
      expect(writeInput).toHaveBeenCalledWith("\x1b[<64;41;13M\x1b[<64;41;13M");
      scroller.add(-2);
      await flush();
      expect(writeInput).toHaveBeenLastCalledWith("\x1b[<64;41;13M");
    });

    it("targets the active pane in a split, not the top-left one", async () => {
      const { scroller, writeInput } = setup({
        client: { mouse: 1, left: 41, top: 12, width: 39, height: 12 },
      });
      scroller.add(3);
      await flush();
      // x = 41 + 19 + 1, y = 12 + 6 + 1
      expect(writeInput).toHaveBeenCalledWith("\x1b[<65;61;19M");
    });

    it("skips a status line at the top (no window switching)", async () => {
      const { scroller, writeInput } = setup({
        client: { mouse: 1, height: 23, position: "top" },
      });
      scroller.add(-3);
      await flush();
      expect(writeInput).toHaveBeenCalledWith("\x1b[<64;41;13M"); // 1 + 11 + 1
    });

    it("accounts for multi-line status bars at the top", async () => {
      const { scroller, writeInput } = setup({
        client: { mouse: 1, height: 20, status: "3", position: "top" },
      });
      scroller.add(-3);
      await flush();
      expect(writeInput).toHaveBeenCalledWith("\x1b[<64;41;14M"); // 3 + 10 + 1
    });

    it("does not carry a remainder into another pane", async () => {
      const { scroller, writeInput, setClient } = setup({
        client: { mouse: 1 },
      });
      scroller.add(-2); // remainder -2, no event yet
      await flush();
      setClient({ pane: "%7", mouse: 1 });
      scroller.add(-1); // would complete an event if carried
      await flush();
      expect(writeInput).not.toHaveBeenCalled();
    });

    it("drops the remainder after scrolling in copy mode", async () => {
      const { scroller, writeInput, setClient } = setup({
        client: { mouse: 1 },
      });
      scroller.add(2);
      await flush();
      setClient({ inMode: 1, mode: "copy-mode", mouse: 1 });
      scroller.add(-1);
      await flush();
      setClient({ mouse: 1 });
      scroller.add(1);
      await flush();
      expect(writeInput).not.toHaveBeenCalled();
    });
  });

  describe("client lookup cache", () => {
    it("reuses the lookup for scrolls in quick succession", async () => {
      const { scroller, calls, advance } = setup();
      scroller.add(-1);
      await flush();
      advance(CLIENT_CACHE_MS - 1);
      scroller.add(-1);
      await flush();
      expect(lookups(calls)).toHaveLength(1);
      expect(scrollCalls(calls)).toHaveLength(2);
    });

    it("looks the client up again once the cache expired", async () => {
      const { scroller, calls, advance } = setup();
      scroller.add(-1);
      await flush();
      advance(CLIENT_CACHE_MS);
      scroller.add(-1);
      await flush();
      expect(lookups(calls)).toHaveLength(2);
    });

    it("knows it is in copy mode after scrolling up (no second copy-mode)", async () => {
      const { scroller, calls } = setup();
      scroller.add(-2);
      await flush();
      scroller.add(-2);
      await flush();
      expect(scrollCalls(calls)[1][0]).toBe("send-keys");
    });

    it("looks up again once copy mode exited at the bottom", async () => {
      const { scroller, calls, setPaneState, setClient } = setup({
        client: { inMode: 1, mode: "copy-mode" },
      });
      setPaneState({ inMode: 0 }); // scrolled back down to live output
      scroller.add(3);
      await flush();
      setClient({}, { expire: false });
      scroller.add(3); // live now: no stale scroll-down
      await flush();
      expect(scrollCalls(calls)).toHaveLength(1);
      expect(lookups(calls)).toHaveLength(2);
    });

    it("never caches live output or mouse apps (nothing refreshes them)", async () => {
      const { scroller, calls } = setup({ client: { mouse: 1 } });
      scroller.add(-3);
      await flush();
      scroller.add(-3);
      await flush();
      expect(lookups(calls)).toHaveLength(2);
    });

    it("retries with a fresh lookup when the cached pane left copy mode", async () => {
      const { scroller, calls, runTmux, setClient } = setup();
      scroller.add(-1);
      await flush();
      setClient({}, { expire: false }); // q pressed: live again
      runTmux.mockRejectedValueOnce(new Error("not in a mode"));
      scroller.add(-2);
      await flush();
      await flush();
      const last = scrollCalls(calls).at(-1);
      expect(last[0]).toBe("copy-mode"); // re-entered, step not lost
      expect(lineCount(last)).toBe("2");
      expect(lookups(calls)).toHaveLength(2);
    });

    it("a lookup in flight during a switch does not refill the cache", async () => {
      const { scroller, calls, runTmux } = setup();
      let release;
      runTmux.mockImplementationOnce(async (args) => {
        calls.push(args);
        await new Promise((r) => (release = r));
        return clientLine({ tty: "/dev/pts/4", inMode: 1, mode: "copy-mode" });
      });
      scroller.add(-1);
      await flush();
      scroller.invalidate(); // switch-client finished meanwhile
      release();
      await flush();
      await flush();
      scroller.add(-1);
      await flush();
      expect(lookups(calls)).toHaveLength(2);
    });

    it("looks the client up again when the state can't be read", async () => {
      const { scroller, calls, setRawPaneState } = setup();
      setRawPaneState("");
      scroller.add(-1);
      await flush();
      scroller.add(-1);
      await flush();
      expect(lookups(calls)).toHaveLength(2);
    });

    it("forgets the client when told to (session/window switch)", async () => {
      const { scroller, calls } = setup();
      scroller.add(-1);
      await flush();
      scroller.invalidate();
      scroller.add(-1);
      await flush();
      expect(lookups(calls)).toHaveLength(2);
    });

    it("forgets the client after a tmux error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { scroller, calls, runTmux } = setup();
      scroller.add(-1);
      await flush();
      runTmux.mockRejectedValueOnce(new Error("can't find pane: %3"));
      scroller.add(-1);
      await flush();
      scroller.add(-1);
      await flush();
      expect(lookups(calls)).toHaveLength(2);
    });
  });

  it("caps the merged scroll so a message flood can't stall tmux", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const calls = [];
    const runTmux = vi.fn(async (args) => {
      calls.push(args);
      if (calls.length === 1) await gate;
      return args[0] === "list-clients"
        ? clientLine({ tty: "/dev/pts/1", inMode: 1, mode: "copy-mode" })
        : "";
    });
    const scroller = createScroller({
      getTty: () => "/dev/pts/1",
      runTmux,
      writeInput: vi.fn(),
    });
    scroller.add(-1);
    for (let i = 0; i < 50; i++) scroller.add(-1000);
    release();
    await flush();
    await flush();
    const counts = scrollCalls(calls).map((c) => Number(lineCount(c)));
    expect(Math.max(...counts)).toBeLessThanOrEqual(1000);
  });

  it("coalesces requests that arrive while tmux is busy", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const calls = [];
    const runTmux = vi.fn(async (args) => {
      calls.push(args);
      if (calls.length === 1) await gate;
      return args[0] === "list-clients"
        ? clientLine({ tty: "/dev/pts/1", inMode: 1, mode: "copy-mode" })
        : "";
    });
    const scroller = createScroller({
      getTty: () => "/dev/pts/1",
      runTmux,
      writeInput: vi.fn(),
    });
    scroller.add(-1);
    scroller.add(-2);
    scroller.add(-3);
    release();
    await flush();
    await flush();
    expect(scrollCalls(calls).map(lineCount)).toEqual(["1", "5"]);
  });

  it("stops once the connection is closed", async () => {
    let closed = false;
    const { scroller, runTmux } = setup({ closed: () => closed });
    closed = true;
    scroller.add(-3);
    await flush();
    expect(runTmux).not.toHaveBeenCalled();
  });

  it("drops scrolls while the PTY tty is unknown", async () => {
    const { scroller, runTmux } = setup({ client: { tty: null } });
    scroller.add(-3);
    await flush();
    expect(runTmux).not.toHaveBeenCalled();
  });

  it("ignores the scroll when its client is not attached", async () => {
    const runTmux = vi.fn(async () => clientLine({ tty: "/dev/pts/2" }));
    const scroller = createScroller({
      getTty: () => "/dev/pts/7",
      runTmux,
      writeInput: vi.fn(),
    });
    scroller.add(-3);
    await flush();
    expect(runTmux).toHaveBeenCalledTimes(1);
  });

  it("keeps working after a tmux error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const runTmux = vi.fn(async (args) => {
      if (fail) {
        fail = false;
        throw new Error("no current client");
      }
      return args[0] === "list-clients"
        ? clientLine({ tty: "/dev/pts/1", inMode: 1, mode: "copy-mode" })
        : "";
    });
    const scroller = createScroller({
      getTty: () => "/dev/pts/1",
      runTmux,
      writeInput: vi.fn(),
    });
    scroller.add(-1);
    await flush();
    scroller.add(-2);
    await flush();
    await flush();
    expect(runTmux.mock.calls.at(-1)[0]).toContain("scroll-up");
  });
});
