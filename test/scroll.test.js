import { describe, it, expect, vi } from "vitest";
import { createScroller, CLIENT_FORMAT } from "../server/scroll.js";

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

function setup({ client = {}, closed = () => false } = {}) {
  const calls = [];
  let current = clientLine(client);
  const runTmux = vi.fn(async (args) => {
    calls.push(args);
    if (args[0] !== "list-clients") return "";
    // another client listed first: ours must be picked by tty
    return `${clientLine({ tty: "/dev/pts/99", pane: "%9", mouse: 1 })}\n${current}\n`;
  });
  const writeInput = vi.fn();
  const scroller = createScroller({
    getTty: () => ("tty" in client ? client.tty : "/dev/pts/4"),
    runTmux,
    writeInput,
    isClosed: closed,
  });
  return {
    scroller,
    runTmux,
    writeInput,
    calls,
    setClient: (c) => (current = clientLine(c)),
  };
}

const scrollCalls = (calls) => calls.filter((c) => c[0] !== "list-clients");

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
    const counts = scrollCalls(calls).map((c) => Number(c.at(-2)));
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
    expect(scrollCalls(calls).map((c) => c.at(-2))).toEqual(["1", "5"]);
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
