import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createConnection } from "../src/connection.js";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.listeners = {};
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, cb) {
    (this.listeners[type] ||= []).push(cb);
  }

  emit(type, event = {}) {
    (this.listeners[type] || []).forEach((cb) => cb(event));
  }

  send(data) {
    this.sent.push(data);
  }

  // Like the browser: close() fires the close event asynchronously
  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSING;
    queueMicrotask(() => this.serverClose(1005, ""));
  }

  // Test helpers
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  serverClose(code = 1006, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  sentJson() {
    return this.sent
      .filter((d) => typeof d === "string" && d.startsWith("{"))
      .map((d) => JSON.parse(d));
  }
}

const latest = () => FakeWebSocket.instances.at(-1);

function setup(overrides = {}) {
  const callbacks = {
    onOutput: vi.fn(),
    onNotice: vi.fn(),
    beforeReconnect: vi.fn().mockResolvedValue(undefined),
  };
  const conn = createConnection({
    session: "main",
    buildUrl: (s) => `ws://test/ws?session=${encodeURIComponent(s)}`,
    getSize: () => ({ cols: 100, rows: 30 }),
    WebSocketImpl: FakeWebSocket,
    ...callbacks,
    ...overrides,
  });
  conn.connect();
  return { conn, ...callbacks };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createConnection", () => {
  it("connects to the session URL and sends its size on open", () => {
    setup();
    expect(latest().url).toBe("ws://test/ws?session=main");
    latest().open();
    expect(latest().sentJson()).toEqual([
      { type: "resize", cols: 100, rows: 30 },
    ]);
  });

  it("forwards binary output and keeps text control frames out of it", () => {
    const { onOutput } = setup();
    latest().open();
    latest().emit("message", { data: new Uint8Array([104, 105]).buffer });
    latest().emit("message", { data: '{"type":"pong"}' });
    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(onOutput.mock.calls[0][0]).toEqual(new Uint8Array([104, 105]));
  });

  it("queues a switch requested while connecting and sends it on open", () => {
    const { conn } = setup();
    conn.switchSession("other", 3);
    expect(latest().sent).toEqual([]);
    latest().open();
    expect(latest().sentJson()).toContainEqual({
      type: "switch",
      session: "other",
      window: 3,
    });
    expect(conn.getSession()).toBe("other");
  });

  it("sends a switch immediately when open, without re-sending later", async () => {
    const { conn } = setup();
    latest().open();
    conn.switchSession("other", null);
    expect(latest().sentJson()).toContainEqual({
      type: "switch",
      session: "other",
      window: null,
    });
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(latest().url).toBe("ws://test/ws?session=other");
    latest().open();
    expect(
      latest()
        .sentJson()
        .map((m) => m.type),
    ).toEqual(["resize"]);
  });

  it("asks beforeReconnect for the session before reconnecting", async () => {
    let conn;
    const beforeReconnect = vi.fn(async () => {
      conn.switchSession("fallback", null); // e.g. "main" was killed
    });
    ({ conn } = setup({ beforeReconnect }));
    latest().open();
    latest().serverClose(1000, "PTY exited");

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(beforeReconnect).toHaveBeenCalledTimes(1);
    expect(latest().url).toBe("ws://test/ws?session=fallback");
  });

  it("still reconnects when beforeReconnect throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ beforeReconnect: vi.fn().mockRejectedValue(new Error("down")) });
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("backs off exponentially and resets after a successful open", async () => {
    setup();
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    latest().open();
    await vi.advanceTimersByTimeAsync(5000); // stayed up → delay resets
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("shows 'taken' and stops when replaced by another connection", async () => {
    const { onNotice } = setup();
    latest().open();
    latest().serverClose(1000, "Replaced by new connection");
    await vi.advanceTimersByTimeAsync(60000);
    expect(onNotice).toHaveBeenCalledWith("taken");
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  describe("checkAlive (page became visible)", () => {
    it("keeps a socket that answers the ping", async () => {
      const { conn } = setup();
      latest().open();
      conn.checkAlive();
      expect(latest().sentJson()).toContainEqual({ type: "ping" });
      latest().emit("message", { data: '{"type":"pong"}' });
      await vi.advanceTimersByTimeAsync(10000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it("replaces a half-dead socket that never answers", async () => {
      const { conn, onNotice } = setup();
      latest().open();
      conn.checkAlive();
      await vi.advanceTimersByTimeAsync(3000);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(onNotice).toHaveBeenCalledWith("reconnecting");
    });

    it("reconnects immediately when the socket is already closed", async () => {
      const { conn } = setup();
      latest().open();
      latest().readyState = FakeWebSocket.CLOSED; // close event lost
      conn.checkAlive();
      await vi.advanceTimersByTimeAsync(0);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it("leaves a socket that is still connecting alone", async () => {
      const { conn } = setup();
      conn.checkAlive();
      await vi.advanceTimersByTimeAsync(0);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  it("ignores events from a replaced socket", async () => {
    const { conn, onOutput, onNotice } = setup();
    latest().open();
    conn.checkAlive();
    await vi.advanceTimersByTimeAsync(3000); // pong timeout → new socket
    const [stale, fresh] = FakeWebSocket.instances;
    fresh.open();
    onNotice.mockClear();

    stale.emit("message", { data: new Uint8Array([1]).buffer });
    stale.serverClose(1000, "Replaced by new connection");
    await vi.advanceTimersByTimeAsync(5000);

    expect(onOutput).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not open a second socket when a manual reconnect races the timer", async () => {
    const { conn } = setup();
    latest().serverClose(); // schedules reconnect in 1s
    latest().readyState = FakeWebSocket.CLOSED;
    conn.checkAlive(); // user returns to the tab immediately
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not steal the session back after being replaced", async () => {
    const { conn } = setup();
    latest().open();
    latest().serverClose(1000, "Replaced by new connection");
    conn.checkAlive(); // user switches back to this tab/app
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("reclaims a taken session only on explicit request", async () => {
    const { conn } = setup();
    latest().open();
    latest().serverClose(1000, "Replaced by new connection");
    conn.switchSession("main", null); // user picks a session in the UI
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("reconnects even if beforeReconnect never settles", async () => {
    setup({ beforeReconnect: () => new Promise(() => {}) });
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1000 + 3000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("keeps backing off when connections open then die immediately", async () => {
    setup();
    latest().open();
    latest().serverClose(1000, "PTY exited"); // e.g. no tmux sessions left
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    latest().open();
    latest().serverClose(1000, "PTY exited");
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeWebSocket.instances).toHaveLength(2); // delay grew to 2s
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("send() only writes to an open socket", () => {
    const { conn } = setup();
    expect(conn.send("x")).toBe(false);
    latest().open();
    expect(conn.send("x")).toBe(true);
    expect(latest().sent).toContain("x");
  });

  it("dispose() closes and never reconnects", async () => {
    const { conn, onNotice } = setup();
    latest().open();
    conn.dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onNotice).not.toHaveBeenCalled();
  });
});
