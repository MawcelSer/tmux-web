// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTouchGestures } from "../src/touch-gestures.js";

function fire(el, type, touches, changedTouches = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: touches });
  Object.defineProperty(event, "changedTouches", { value: changedTouches });
  el.dispatchEvent(event);
  return event;
}

const pt = (clientX, clientY) => ({ clientX, clientY });

describe("setupTouchGestures", () => {
  let container;
  let term;
  let sendKeys;
  let clicks;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "Date",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    container = document.createElement("div");
    document.body.replaceChildren(container);
    term = { blur: vi.fn(), options: { fontSize: 14 } };
    sendKeys = vi.fn();
    clicks = vi.fn();
    container.addEventListener("click", clicks);
    setupTouchGestures(container, term, sendKeys);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function tap(x = 50, y = 50) {
    fire(container, "touchstart", [pt(x, y)]);
    fire(container, "touchend", [], [pt(x, y)]);
  }

  function flick(fromY, toY, steps = 4) {
    fire(container, "touchstart", [pt(100, fromY)]);
    const stepPx = (toY - fromY) / steps;
    for (let i = 1; i <= steps; i++) {
      vi.advanceTimersByTime(16);
      fire(container, "touchmove", [pt(100, fromY + stepPx * i)]);
    }
    fire(container, "touchend", [], [pt(100, toY)]);
  }

  it("turns a tap into a synthesized click", () => {
    tap();
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(term.blur).toHaveBeenCalled();
  });

  it("scrolls on vertical drag with mouse-wheel sequences and no click", () => {
    flick(500, 300);
    vi.advanceTimersByTime(16);
    expect(sendKeys).toHaveBeenCalled();
    expect(sendKeys.mock.calls[0][0]).toMatch(/^(\x1b\[<65;1;1M)+$/);
    expect(clicks).not.toHaveBeenCalled();
  });

  it("keeps scrolling with momentum after a fast flick", () => {
    flick(500, 260);
    sendKeys.mockClear();
    vi.advanceTimersByTime(100);
    expect(sendKeys).toHaveBeenCalled();
  });

  it("a tap that stops momentum does not click (keyboard stays closed)", () => {
    flick(500, 260);
    vi.advanceTimersByTime(32); // momentum running
    tap();
    expect(clicks).not.toHaveBeenCalled();

    sendKeys.mockClear();
    vi.advanceTimersByTime(200);
    expect(sendKeys).not.toHaveBeenCalled(); // momentum stopped

    tap(); // next tap after the coast is a normal tap
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("does not click when fingers lift after a pinch", () => {
    const zooms = vi.fn();
    container.addEventListener("pinch-zoom", zooms);

    fire(container, "touchstart", [pt(100, 100)]);
    fire(container, "touchstart", [pt(100, 100), pt(200, 200)]);
    fire(container, "touchmove", [pt(50, 50), pt(250, 250)]);
    fire(container, "touchend", [pt(50, 50)], [pt(250, 250)]);
    fire(container, "touchend", [], [pt(50, 50)]);

    expect(zooms).toHaveBeenCalled();
    expect(zooms.mock.calls[0][0].detail.fontSize).toBeGreaterThan(14);
    expect(clicks).not.toHaveBeenCalled();
  });

  it("dispatches swipe-session for a long horizontal swipe", () => {
    const swipes = vi.fn();
    container.addEventListener("swipe-session", swipes);
    const far = window.innerWidth * 0.6;

    fire(container, "touchstart", [pt(10, 100)]);
    fire(container, "touchmove", [pt(10 + far / 2, 102)]);
    fire(container, "touchmove", [pt(10 + far, 104)]);
    fire(container, "touchend", [], [pt(10 + far, 104)]);

    expect(swipes).toHaveBeenCalledTimes(1);
    expect(swipes.mock.calls[0][0].detail.direction).toBe("next");
    expect(clicks).not.toHaveBeenCalled();
  });

  it("a tap still works after a pinch was cancelled by the OS", () => {
    fire(container, "touchstart", [pt(100, 100)]);
    fire(container, "touchstart", [pt(100, 100), pt(200, 200)]);
    fire(container, "touchcancel", []);
    tap();
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("touchcancel stops momentum", () => {
    flick(500, 260);
    fire(container, "touchcancel", []);
    sendKeys.mockClear();
    vi.advanceTimersByTime(200);
    expect(sendKeys).not.toHaveBeenCalled();
  });
});
