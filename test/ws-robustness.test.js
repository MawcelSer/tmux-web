import { describe, it, expect, afterEach, vi } from "vitest";
import net from "node:net";
import WebSocket from "ws";
import { createServer } from "../server/ws-server.js";

let server;

async function startServer(opts = {}) {
  server = createServer({
    port: 0,
    tmuxExecFn: vi.fn().mockResolvedValue(""),
    ...opts,
  });
  await new Promise((resolve) => server.httpServer.on("listening", resolve));
  return `http://localhost:${server.httpServer.address().port}`;
}

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

function makePty({ tty = "/dev/pts/7" } = {}) {
  return {
    dataCallbacks: [],
    exitCallbacks: [],
    written: [],
    killed: false,
    tty,
    write(d) {
      this.written.push(d.toString());
    },
    resize() {},
    kill() {
      this.killed = true;
    },
    getTty() {
      return this.tty;
    },
    onData(cb) {
      this.dataCallbacks.push(cb);
    },
    onExit(cb) {
      this.exitCallbacks.push(cb);
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openWs(base, session) {
  const ws = new WebSocket(
    `${base.replace("http", "ws")}/ws?session=${encodeURIComponent(session)}`,
  );
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  return ws;
}

/** Send a raw HTTP request (fetch() normalizes away malformed input). */
function rawRequest(port, requestText) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "localhost", () => sock.write(requestText));
    let data = "";
    sock.on("data", (c) => (data += c));
    sock.on("end", () => resolve(data));
    sock.on("error", reject);
  });
}

describe("HTTP robustness", () => {
  it("returns 400 (and keeps running) for malformed percent-encoding", async () => {
    const base = await startServer({ listWindowsFn: vi.fn() });
    const res = await fetch(`${base}/api/windows/%E0%A4%A`);
    expect(res.status).toBe(400);
    const again = await fetch(`${base}/api/windows/main`);
    expect(again.status).not.toBe(400);
  });

  it("returns 400 for invalid session names without calling tmux", async () => {
    const listWindowsFn = vi.fn().mockResolvedValue([]);
    const base = await startServer({ listWindowsFn });
    const res = await fetch(`${base}/api/windows/${encodeURIComponent("a:b")}`);
    expect(res.status).toBe(400);
    expect(listWindowsFn).not.toHaveBeenCalled();
  });

  it("returns 500 when listing sessions throws, instead of crashing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = await startServer({
      listSessionsFn: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const res = await fetch(`${base}/api/sessions`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });

  it("survives a malformed Host header", async () => {
    await startServer({ listSessionsFn: vi.fn().mockResolvedValue([]) });
    const port = server.httpServer.address().port;
    const reply = await rawRequest(
      port,
      "GET /api/sessions HTTP/1.1\r\nHost: [bad\r\nConnection: close\r\n\r\n",
    );
    expect(reply).toMatch(/^HTTP\/1\.1 200/);
  });
});

describe("WebSocket control messages", () => {
  it("replies to ping with a text pong frame", async () => {
    const base = await startServer({ createPtyFn: () => makePty() });
    const ws = await openWs(base, "main");
    const reply = new Promise((resolve) =>
      ws.on("message", (data, isBinary) => resolve({ data, isBinary })),
    );
    ws.send(JSON.stringify({ type: "ping" }));
    const { data, isBinary } = await reply;
    expect(isBinary).toBe(false);
    expect(JSON.parse(data.toString())).toEqual({ type: "pong" });
    ws.close();
  });

  it("rejects oversized frames via maxPayload", async () => {
    const pty = makePty();
    const base = await startServer({ createPtyFn: () => pty });
    const ws = await openWs(base, "main");
    const closed = new Promise((resolve) => ws.on("close", resolve));
    ws.send("x".repeat(2 * 1024 * 1024));
    expect(await closed).toBe(1009);
    expect(pty.written).toEqual([]);
  });
});

describe("switch-client", () => {
  it("waits for the PTY tty instead of dropping the switch", async () => {
    const pty = makePty({ tty: null });
    const tmuxExecFn = vi.fn().mockResolvedValue("");
    const base = await startServer({ createPtyFn: () => pty, tmuxExecFn });
    const ws = await openWs(base, "main");

    ws.send(JSON.stringify({ type: "switch", session: "other", window: 2 }));
    await wait(30);
    expect(tmuxExecFn).not.toHaveBeenCalled();

    pty.tty = "/dev/pts/9";
    await wait(250);
    expect(tmuxExecFn).toHaveBeenCalledWith([
      "switch-client",
      "-c",
      "/dev/pts/9",
      "-t",
      "other:2",
    ]);
    ws.close();
  });

  it("retries when tmux has not registered the client yet", async () => {
    const tmuxExecFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("can't find client"))
      .mockResolvedValue("");
    const base = await startServer({
      createPtyFn: () => makePty(),
      tmuxExecFn,
    });
    const ws = await openWs(base, "main");
    ws.send(JSON.stringify({ type: "switch", session: "other" }));
    await wait(300);
    expect(tmuxExecFn).toHaveBeenCalledTimes(2);
    ws.close();
  });

  it("re-keys connection dedup to the session it switched to", async () => {
    const ptys = [makePty(), makePty(), makePty()];
    let n = 0;
    const base = await startServer({ createPtyFn: () => ptys[n++] });

    const phone = await openWs(base, "alpha");
    phone.send(JSON.stringify({ type: "switch", session: "beta" }));
    await wait(50);

    // Another device opening "alpha" must not evict the phone (now on beta)
    const laptop = await openWs(base, "alpha");
    await wait(30);
    expect(ptys[0].killed).toBe(false);

    // ...but a fresh connection to "beta" replaces the phone's stale bridge
    const phoneReconnect = await openWs(base, "beta");
    await wait(30);
    expect(ptys[0].killed).toBe(true);
    expect(ptys[1].killed).toBe(false);

    laptop.close();
    phoneReconnect.close();
  });
});

describe("heartbeat", () => {
  it("terminates clients that stop answering pings and kills their PTY", async () => {
    const pty = makePty();
    const base = await startServer({
      createPtyFn: () => pty,
      heartbeatMs: 40,
    });
    // autoPong: false simulates a half-dead mobile connection
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?session=main`, {
      autoPong: false,
    });
    await new Promise((resolve) => ws.on("open", resolve));
    const closed = new Promise((resolve) => ws.on("close", resolve));
    await closed;
    await wait(10);
    expect(pty.killed).toBe(true);
  });

  it("keeps clients that answer pings", async () => {
    const pty = makePty();
    const base = await startServer({
      createPtyFn: () => pty,
      heartbeatMs: 40,
    });
    const ws = await openWs(base, "main");
    await wait(200);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(pty.killed).toBe(false);
    ws.close();
  });
});

describe("origin check (cross-site WebSocket hijacking)", () => {
  function connectWithHeaders(base, headers) {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?session=main`, {
      headers,
    });
    return new Promise((resolve) => {
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("unexpected-response", (req, res) => resolve(res.statusCode));
      ws.on("error", () => resolve("error"));
    });
  }

  it("rejects a WebSocket from a foreign origin without spawning a PTY", async () => {
    const createPtyFn = vi.fn(() => makePty());
    const base = await startServer({ createPtyFn });
    const result = await connectWithHeaders(base, {
      Origin: "https://evil.example",
    });
    expect(result).toBe(403);
    expect(createPtyFn).not.toHaveBeenCalled();
  });

  it("accepts a same-origin browser connection", async () => {
    const base = await startServer({ createPtyFn: () => makePty() });
    const host = new URL(base).host;
    expect(await connectWithHeaders(base, { Origin: `http://${host}` })).toBe(
      "open",
    );
  });

  it("accepts origins from the allowlist (e.g. a reverse proxy hostname)", async () => {
    const base = await startServer({
      createPtyFn: () => makePty(),
      allowedOrigins: ["https://box.tailnet.ts.net"],
    });
    expect(
      await connectWithHeaders(base, { Origin: "https://box.tailnet.ts.net" }),
    ).toBe("open");
  });

  it("accepts non-browser clients that send no Origin", async () => {
    const base = await startServer({ createPtyFn: () => makePty() });
    expect(await connectWithHeaders(base, {})).toBe("open");
  });
});

describe("review follow-ups", () => {
  it("returns 400 for an unparseable request target", async () => {
    await startServer();
    const port = server.httpServer.address().port;
    const reply = await rawRequest(
      port,
      "GET // HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(reply).toMatch(/^HTTP\/1\.1 400/);
  });

  it("fails fast when the switch target session does not exist", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tmuxExecFn = vi
      .fn()
      .mockRejectedValue(new Error("can't find session: gone"));
    const base = await startServer({
      createPtyFn: () => makePty(),
      tmuxExecFn,
    });
    const ws = await openWs(base, "main");
    ws.send(JSON.stringify({ type: "switch", session: "gone" }));
    await wait(350);
    expect(tmuxExecFn).toHaveBeenCalledTimes(1);
    ws.close();
  });

  it("stops retrying switches for a connection that was replaced", async () => {
    const ptys = [makePty({ tty: null }), makePty()];
    let n = 0;
    const tmuxExecFn = vi.fn().mockResolvedValue("");
    const base = await startServer({
      createPtyFn: () => ptys[n++],
      tmuxExecFn,
    });
    const first = await openWs(base, "main");
    first.send(JSON.stringify({ type: "switch", session: "other" }));
    await wait(30);
    const second = await openWs(base, "main"); // replaces first
    ptys[0].tty = "/dev/pts/5"; // would succeed if still retrying
    await wait(250);
    expect(tmuxExecFn).not.toHaveBeenCalled();
    second.close();
  });
});
