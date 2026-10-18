import { describe, it, expect, beforeEach } from "vitest";
import { createKineticScroller } from "../src/kinetic-scroll.js";

/** Manual clock + frame queue so the physics are deterministic. */
function makeEnv({ lineHeight = 20 } = {}) {
  let time = 0;
  let frames = new Map();
  let nextId = 1;
  const scrolled = [];
  const scroller = createKineticScroller({
    getLineHeight: () => lineHeight,
    onScroll: (lines) => scrolled.push(lines),
    now: () => time,
    raf: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    caf: (id) => frames.delete(id),
  });
  return {
    scroller,
    scrolled,
    total: () => scrolled.reduce((a, b) => a + b, 0),
    advance(ms) {
      time += ms;
    },
    /** Run frames every `step` ms until none are queued (or the cap). */
    runFrames(max = 1000, step = 16) {
      let count = 0;
      while (frames.size && count < max) {
        time += step;
        const pending = [...frames.values()];
        frames = new Map();
        pending.forEach((cb) => cb());
        count++;
      }
      return count;
    },
    pendingFrames: () => frames.size,
  };
}

describe("createKineticScroller", () => {
  let env;

  beforeEach(() => {
    env = makeEnv({ lineHeight: 20 });
  });

  /** Drag `px` over `ms` in 16ms steps (positive = finger moves up). */
  function drag(px, ms) {
    env.scroller.begin();
    const steps = Math.max(1, Math.round(ms / 16));
    for (let i = 0; i < steps; i++) {
      env.advance(16);
      env.scroller.move(px / steps);
    }
  }

  it("tracks the finger 1:1 — one line per line height", () => {
    drag(100, 160); // slow drag
    env.runFrames(1);
    expect(env.total()).toBe(5);
  });

  it("keeps the sub-line remainder instead of dropping it", () => {
    env.scroller.begin();
    env.scroller.move(15);
    env.runFrames(1);
    env.scroller.move(15);
    env.runFrames(1);
    expect(env.total()).toBe(1); // 30px = 1 line + 10px kept
  });

  it("scrolls both directions", () => {
    drag(-60, 300);
    env.runFrames(1);
    expect(env.total()).toBe(-3);
  });

  it("batches lines into at most one callback per frame", () => {
    env.scroller.begin();
    for (let i = 0; i < 10; i++) env.scroller.move(10);
    env.runFrames(1);
    expect(env.scrolled).toEqual([5]);
  });

  it("a flick keeps coasting after release (throw)", () => {
    drag(240, 80); // 3 px/ms
    env.scroller.release();
    const afterRelease = env.total();
    expect(env.scroller.isCoasting()).toBe(true);
    env.runFrames();
    expect(env.total()).toBeGreaterThan(afterRelease + 20);
    expect(env.scroller.isCoasting()).toBe(false);
  });

  it("coasts further for a faster flick", () => {
    drag(160, 80);
    env.scroller.release();
    env.runFrames();
    const slow = env.total();

    const fast = makeEnv({ lineHeight: 20 });
    fast.scroller.begin();
    for (let i = 0; i < 5; i++) {
      fast.advance(16);
      fast.scroller.move(64);
    }
    fast.scroller.release();
    fast.runFrames();
    expect(fast.total()).toBeGreaterThan(slow);
  });

  it("does not throw when the finger paused before lifting", () => {
    drag(240, 80);
    env.advance(150); // finger held still
    env.scroller.release();
    expect(env.scroller.isCoasting()).toBe(false);
    env.runFrames();
    expect(env.total()).toBe(12); // only what was dragged
  });

  it("does not throw on a slow drag", () => {
    drag(40, 400); // 0.1 px/ms
    env.scroller.release();
    expect(env.scroller.isCoasting()).toBe(false);
  });

  it("decays independently of frame rate (60Hz vs 120Hz)", () => {
    const run = (frameMs) => {
      const e = makeEnv({ lineHeight: 20 });
      e.scroller.begin();
      for (let i = 0; i < 5; i++) {
        e.advance(16);
        e.scroller.move(48);
      }
      e.scroller.release();
      e.runFrames(5000, frameMs);
      return e.total();
    };
    expect(Math.abs(run(16) - run(8))).toBeLessThanOrEqual(1);
  });

  it("stop() halts coasting immediately", () => {
    drag(240, 80);
    env.scroller.release();
    env.runFrames(2);
    env.scroller.stop();
    const stoppedAt = env.total();
    env.runFrames();
    expect(env.total()).toBe(stoppedAt);
    expect(env.scroller.isCoasting()).toBe(false);
  });

  it("begin() stops a coast in progress", () => {
    drag(240, 80);
    env.scroller.release();
    env.scroller.begin();
    expect(env.scroller.isCoasting()).toBe(false);
  });

  it("caps absurd release velocities", () => {
    const coastFrom = (px) => {
      const e = makeEnv({ lineHeight: 20 });
      e.scroller.begin();
      e.advance(1);
      e.scroller.move(px); // glitchy sample
      e.scroller.release();
      const dragged = e.total();
      e.runFrames();
      return e.total() - dragged;
    };
    expect(coastFrom(5000)).toBe(coastFrom(200)); // both hit the cap
  });

  it("a normal flick travels several screens (~100+ lines)", () => {
    // 1.5 px/ms: a quick, ordinary flick on a phone
    env.scroller.begin();
    for (let i = 0; i < 6; i++) {
      env.advance(16);
      env.scroller.move(24);
    }
    env.scroller.release();
    env.runFrames();
    expect(env.total()).toBeGreaterThanOrEqual(100);
  });

  it("flicking again while coasting adds speed (fling boost)", () => {
    const flick = () => {
      env.scroller.begin();
      for (let i = 0; i < 4; i++) {
        env.advance(16);
        env.scroller.move(32);
      }
      env.scroller.release();
    };
    const single = makeEnv({ lineHeight: 20 });
    single.scroller.begin();
    for (let i = 0; i < 4; i++) {
      single.advance(16);
      single.scroller.move(32);
    }
    single.scroller.release();
    single.runFrames();

    flick();
    env.runFrames(3); // still coasting fast
    flick(); // second flick, same direction
    env.runFrames();
    // two boosted flicks go much further than two separate ones would
    expect(env.total()).toBeGreaterThan(single.total() * 2.2);
  });

  it("a flick in the other direction reverses instead of boosting", () => {
    env.scroller.begin();
    for (let i = 0; i < 4; i++) {
      env.advance(16);
      env.scroller.move(40);
    }
    env.scroller.release();
    env.runFrames(3);
    const before = env.total();
    env.scroller.begin();
    for (let i = 0; i < 4; i++) {
      env.advance(16);
      env.scroller.move(-40);
    }
    env.scroller.release();
    env.runFrames();
    expect(env.total()).toBeLessThan(before);
  });

  it("a tap that stops the coast does not carry speed into the next flick", () => {
    env.scroller.begin();
    for (let i = 0; i < 4; i++) {
      env.advance(16);
      env.scroller.move(40);
    }
    env.scroller.release();
    env.runFrames(3);
    env.scroller.begin(); // tap to stop
    env.scroller.release();
    expect(env.scroller.isCoasting()).toBe(false);
  });
});
