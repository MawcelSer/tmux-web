import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "../server/ws-server.js";
import WebSocket from "ws";

let server;

async function startServer(opts = {}) {
  server = createServer({ port: 0, ...opts });
  await new Promise((resolve) => server.httpServer.on("listening", resolve));
  const addr = server.httpServer.address();
  return `http://localhost:${addr.port}`;
}

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("REST API", () => {
  it("GET /api/sessions returns JSON with sessions array", async () => {
    const mockListSessions = vi
      .fn()
      .mockResolvedValue([
        {
          name: "main",
          windows: 2,
          created: "Mon Jan  6 10:00:00 2025",
          attached: true,
        },
      ]);
    const base = await startServer({ listSessionsFn: mockListSessions });
    const res = await fetch(`${base}/api/sessions`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].name).toBe("main");
  });

  it("GET /api/sessions returns empty when no tmux server", async () => {
    const mockListSessions = vi.fn().mockResolvedValue([]);
    const base = await startServer({ listSessionsFn: mockListSessions });
    const res = await fetch(`${base}/api/sessions`);
    const data = await res.json();
    expect(data.sessions).toEqual([]);
  });

  it("GET /api/windows/:session returns windows", async () => {
    const mockListWindows = vi
      .fn()
      .mockResolvedValue([
        { index: 0, name: "bash", active: true, flags: "*" },
      ]);
    const base = await startServer({ listWindowsFn: mockListWindows });
    const res = await fetch(`${base}/api/windows/main`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.windows).toHaveLength(1);
    expect(mockListWindows).toHaveBeenCalledWith("main");
  });

  it("GET /api/windows/:session returns 404 on error", async () => {
    const mockListWindows = vi
      .fn()
      .mockRejectedValue(new Error("can't find session"));
    const base = await startServer({ listWindowsFn: mockListWindows });
    const res = await fetch(`${base}/api/windows/nope`);
    expect(res.status).toBe(404);
  });

  it("unknown routes return 404", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe("WebSocket", () => {
  it("connects and receives data from mock PTY", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      written: [],
      killed: false,
      write(d) {
        this.written.push(d);
      },
      resize() {},
      kill() {
        this.killed = true;
      },
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // Simulate PTY sending data
    const received = [];
    ws.on("message", (data) => received.push(data));
    mockPty.dataCallbacks.forEach((cb) => cb(Buffer.from("hello from pty")));

    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].toString()).toBe("hello from pty");

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("forwards WS messages to PTY stdin", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      written: [],
      killed: false,
      write(d) {
        this.written.push(d.toString());
      },
      resize() {},
      kill() {
        this.killed = true;
      },
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send("user input");
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toContain("user input");

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("handles resize JSON messages", async () => {
    const resizes = [];
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      write() {},
      resize(c, r) {
        resizes.push({ cols: c, rows: r });
      },
      kill() {},
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("kills PTY when WebSocket closes", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      killed: false,
      write() {},
      resize() {},
      kill() {
        this.killed = true;
      },
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(mockPty.killed).toBe(true);
  });

  it("closes WebSocket when PTY exits", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      write() {},
      resize() {},
      kill() {},
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    const closed = new Promise((resolve) => ws.on("close", resolve));
    // Simulate PTY exit
    mockPty.exitCallbacks.forEach((cb) => cb(0));
    await closed;
    // If we get here, the WS was closed
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("does not write switch message to PTY stdin (handled server-side)", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      written: [],
      write(d) {
        this.written.push(d.toString());
      },
      resize() {},
      kill() {},
      getTty() {
        return "/dev/pts/99";
      },
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "switch", session: "other", window: 0 }));
    await new Promise((r) => setTimeout(r, 50));
    // Switch is handled via server-side exec, NOT written to PTY
    expect(mockPty.written).toEqual([]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("does not write new-window message to PTY stdin", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      written: [],
      write(d) {
        this.written.push(d.toString());
      },
      resize() {},
      kill() {},
      getTty() {
        return "/dev/pts/99";
      },
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "new-window", session: "main" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("does not write kill-session message to PTY stdin", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      written: [],
      write(d) {
        this.written.push(d.toString());
      },
      resize() {},
      kill() {},
      getTty() {
        return "/dev/pts/99";
      },
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "kill-session", name: "old-session" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("does not write kill-window message to PTY stdin", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      written: [],
      write(d) {
        this.written.push(d.toString());
      },
      resize() {},
      kill() {},
      getTty() {
        return "/dev/pts/99";
      },
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=test";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(
      JSON.stringify({ type: "kill-window", session: "main", window: 0 }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("kills old PTY when new WS connects for same session", async () => {
    const mockPtys = [
      {
        dataCallbacks: [],
        exitCallbacks: [],
        killed: false,
        write() {},
        resize() {},
        kill() {
          this.killed = true;
        },
        onData(cb) {
          this.dataCallbacks.push(cb);
        },
        onExit(cb) {
          this.exitCallbacks.push(cb);
        },
      },
      {
        dataCallbacks: [],
        exitCallbacks: [],
        killed: false,
        write() {},
        resize() {},
        kill() {
          this.killed = true;
        },
        onData(cb) {
          this.dataCallbacks.push(cb);
        },
        onExit(cb) {
          this.exitCallbacks.push(cb);
        },
      },
    ];
    let callCount = 0;
    const mockCreatePty = vi.fn(() => mockPtys[callCount++]);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=mydev";

    const ws1 = new WebSocket(wsUrl);
    await new Promise((resolve) => ws1.on("open", resolve));

    const ws2 = new WebSocket(wsUrl);
    await new Promise((resolve) => ws2.on("open", resolve));

    // First PTY should have been killed when second connection arrived
    expect(mockPtys[0].killed).toBe(true);
    expect(mockPtys[1].killed).toBe(false);

    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("sends close code 1000 with reason when replacing a session", async () => {
    const mockPtys = [
      {
        dataCallbacks: [],
        exitCallbacks: [],
        killed: false,
        write() {},
        resize() {},
        kill() {
          this.killed = true;
        },
        onData(cb) {
          this.dataCallbacks.push(cb);
        },
        onExit(cb) {
          this.exitCallbacks.push(cb);
        },
      },
      {
        dataCallbacks: [],
        exitCallbacks: [],
        killed: false,
        write() {},
        resize() {},
        kill() {
          this.killed = true;
        },
        onData(cb) {
          this.dataCallbacks.push(cb);
        },
        onExit(cb) {
          this.exitCallbacks.push(cb);
        },
      },
    ];
    let callCount = 0;
    const mockCreatePty = vi.fn(() => mockPtys[callCount++]);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=mydev";

    const ws1 = new WebSocket(wsUrl);
    await new Promise((resolve) => ws1.on("open", resolve));

    const closePromise = new Promise((resolve) => {
      ws1.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const ws2 = new WebSocket(wsUrl);
    await new Promise((resolve) => ws2.on("open", resolve));

    const { code, reason } = await closePromise;
    expect(code).toBe(1000);
    expect(reason).toBe("Replaced by new connection");

    ws2.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("does not kill PTY for different session names", async () => {
    const mockPtys = [
      {
        dataCallbacks: [],
        exitCallbacks: [],
        killed: false,
        write() {},
        resize() {},
        kill() {
          this.killed = true;
        },
        onData(cb) {
          this.dataCallbacks.push(cb);
        },
        onExit(cb) {
          this.exitCallbacks.push(cb);
        },
      },
      {
        dataCallbacks: [],
        exitCallbacks: [],
        killed: false,
        write() {},
        resize() {},
        kill() {
          this.killed = true;
        },
        onData(cb) {
          this.dataCallbacks.push(cb);
        },
        onExit(cb) {
          this.exitCallbacks.push(cb);
        },
      },
    ];
    let callCount = 0;
    const mockCreatePty = vi.fn(() => mockPtys[callCount++]);
    const base = await startServer({ createPtyFn: mockCreatePty });

    const ws1 = new WebSocket(base.replace("http", "ws") + "/ws?session=dev");
    await new Promise((resolve) => ws1.on("open", resolve));

    const ws2 = new WebSocket(base.replace("http", "ws") + "/ws?session=prod");
    await new Promise((resolve) => ws2.on("open", resolve));

    // Neither PTY should be killed — different sessions
    expect(mockPtys[0].killed).toBe(false);
    expect(mockPtys[1].killed).toBe(false);

    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("passes session name from query string to createPty", async () => {
    const mockPty = {
      dataCallbacks: [],
      exitCallbacks: [],
      write() {},
      resize() {},
      kill() {},
      onData(cb) {
        this.dataCallbacks.push(cb);
      },
      onExit(cb) {
        this.exitCallbacks.push(cb);
      },
    };
    const mockCreatePty = vi.fn(() => mockPty);
    const base = await startServer({ createPtyFn: mockCreatePty });
    const wsUrl = base.replace("http", "ws") + "/ws?session=mydev";

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    expect(mockCreatePty).toHaveBeenCalledWith(
      expect.objectContaining({ session: "mydev" }),
    );

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});
