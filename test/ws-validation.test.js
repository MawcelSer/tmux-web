import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "../server/ws-server.js";
import WebSocket from "ws";

let server;

function makeMockPty() {
  return {
    dataCallbacks: [],
    exitCallbacks: [],
    written: [],
    resizes: [],
    killed: false,
    tty: "/dev/pts/99",
    write(d) {
      this.written.push(d.toString());
    },
    resize(c, r) {
      this.resizes.push({ cols: c, rows: r });
    },
    kill() {
      this.killed = true;
    },
    onData(cb) {
      this.dataCallbacks.push(cb);
    },
    onExit(cb) {
      this.exitCallbacks.push(cb);
    },
    getTty() {
      return this.tty;
    },
  };
}

async function startServer(opts = {}) {
  const mockPty = makeMockPty();
  const mockCreatePty = vi.fn(() => mockPty);
  server = createServer({
    port: 0,
    createPtyFn: mockCreatePty,
    listSessionsFn: vi.fn().mockResolvedValue([]),
    listWindowsFn: vi.fn().mockResolvedValue([]),
    ...opts,
  });
  await new Promise((resolve) => server.httpServer.on("listening", resolve));
  const addr = server.httpServer.address();
  return { base: `http://localhost:${addr.port}`, mockPty };
}

async function connectWs(base, session = "test") {
  const wsUrl = base.replace("http", "ws") + `/ws?session=${session}`;
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.on("open", resolve));
  return ws;
}

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("REST method guards", () => {
  it("POST /api/sessions returns 405", async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/api/sessions`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("POST /api/windows/main returns 405", async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/api/windows/main`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("CORS header removed", () => {
  it("API responses do not include Access-Control-Allow-Origin", async () => {
    const { base } = await startServer({
      listSessionsFn: vi.fn().mockResolvedValue([]),
    });
    const res = await fetch(`${base}/api/sessions`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("resize validation", () => {
  it("accepts valid integer cols/rows", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.resizes).toEqual([{ cols: 120, rows: 40 }]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("rejects non-integer cols", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "resize", cols: "abc", rows: 40 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.resizes).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("rejects cols > 500", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "resize", cols: 99999, rows: 40 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.resizes).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("rejects cols <= 0", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "resize", cols: 0, rows: 40 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.resizes).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("switch message validation", () => {
  it("rejects switch with invalid session name", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "switch", session: "bad;name", window: 0 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("rejects switch with non-integer window", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "switch", session: "main", window: -1 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("accepts switch with window index 0 (minimum valid)", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "switch", session: "main", window: 0 }));
    await new Promise((r) => setTimeout(r, 50));
    // Window index 0 is valid — message should not be forwarded to PTY stdin
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("kill-session validation", () => {
  it("rejects kill-session with invalid name", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "kill-session", name: "bad;name" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("rejects kill-session with empty name", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "kill-session", name: "" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("kill-window validation", () => {
  it("rejects kill-window with invalid session name", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(
      JSON.stringify({ type: "kill-window", session: "../etc", window: 0 }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it("rejects kill-window with negative window index", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(
      JSON.stringify({ type: "kill-window", session: "main", window: -1 }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("new-window validation", () => {
  it("rejects new-window with invalid session name", async () => {
    const { base, mockPty } = await startServer();
    const ws = await connectWs(base);
    ws.send(JSON.stringify({ type: "new-window", session: "" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPty.written).toEqual([]);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("error message sanitization", () => {
  it("returns generic error for windows 404", async () => {
    const { base } = await startServer({
      listWindowsFn: vi
        .fn()
        .mockRejectedValue(
          new Error("can't find session: /tmp/tmux-1000/default"),
        ),
    });
    const res = await fetch(`${base}/api/windows/nope`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Session not found");
    expect(data.error).not.toContain("/tmp");
  });
});
