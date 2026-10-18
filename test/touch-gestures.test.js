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
  let onScroll;
  let clicks;
  let selection;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    container = document.createElement("div");
    document.body.replaceChildren(container);
    term = { blur: vi.fn(), options: { fontSize: 14 } };
    onScroll = vi.fn();
    clicks = vi.fn();
    container.addEventListener("click", clicks);
    selection = {
      active: false,
      isActive: vi.fn(() => selection.active),
      startAt: vi.fn(() => (selection.active = true)),
      dragTo: vi.fn(),
      hitHandle: vi.fn(() => null),
      grab: vi.fn(),
      clear: vi.fn(() => (selection.active = false)),
    };
    setupTouchGestures(container, term, {
      onScroll,
      getLineHeight: () => 14,
      selection,
    });
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

  it("scrolls on vertical drag (positive lines = newer output) and no click", () => {
    flick(500, 300);
    vi.advanceTimersByTime(16);
    expect(onScroll).toHaveBeenCalled();
    expect(onScroll.mock.calls[0][0]).toBeGreaterThan(0);
    expect(clicks).not.toHaveBeenCalled();
  });

  it("keeps scrolling with momentum after a fast flick", () => {
    flick(500, 260);
    onScroll.mockClear();
    vi.advanceTimersByTime(100);
    expect(onScroll).toHaveBeenCalled();
  });

  it("a tap that stops momentum does not click (keyboard stays closed)", () => {
    flick(500, 260);
    vi.advanceTimersByTime(32); // momentum running
    tap();
    expect(clicks).not.toHaveBeenCalled();

    onScroll.mockClear();
    vi.advanceTimersByTime(200);
    expect(onScroll).not.toHaveBeenCalled(); // momentum stopped

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

  describe("long-press selection", () => {
    it("holding still selects at the finger, without a click or keyboard", () => {
      fire(container, "touchstart", [pt(50, 60)]);
      vi.advanceTimersByTime(500);
      expect(selection.startAt).toHaveBeenCalledWith(50, 60);
      fire(container, "touchend", [], [pt(50, 60)]);
      expect(clicks).not.toHaveBeenCalled();
    });

    it("dragging after the long-press extends the selection, not scroll", () => {
      fire(container, "touchstart", [pt(50, 60)]);
      vi.advanceTimersByTime(500);
      fire(container, "touchmove", [pt(120, 90)]);
      vi.advanceTimersByTime(16);
      expect(selection.dragTo).toHaveBeenCalledWith(120, 90, undefined);
      expect(onScroll).not.toHaveBeenCalled();
    });

    it("moving before the delay scrolls instead (no selection)", () => {
      fire(container, "touchstart", [pt(50, 300)]);
      vi.advanceTimersByTime(100);
      fire(container, "touchmove", [pt(50, 250)]);
      vi.advanceTimersByTime(600);
      expect(selection.startAt).not.toHaveBeenCalled();
    });

    it("a quick tap is still a tap", () => {
      tap();
      vi.advanceTimersByTime(600);
      expect(selection.startAt).not.toHaveBeenCalled();
      expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("with a selection, a touch on a handle drags that handle", () => {
      selection.active = true;
      selection.hitHandle.mockReturnValue("start");
      fire(container, "touchstart", [pt(30, 40)]);
      fire(container, "touchmove", [pt(10, 40)]);
      fire(container, "touchend", [], [pt(10, 40)]);
      expect(selection.grab).toHaveBeenCalledWith("start", 30, 40);
      expect(selection.dragTo).toHaveBeenCalledWith(10, 40, "start");
      expect(selection.clear).not.toHaveBeenCalled();
      expect(clicks).not.toHaveBeenCalled();
    });

    it("with a selection, tapping elsewhere clears it without a click", () => {
      selection.active = true;
      tap();
      expect(selection.clear).toHaveBeenCalled();
      expect(clicks).not.toHaveBeenCalled();
    });

    it("with a selection, starting to scroll clears it", () => {
      selection.active = true;
      flick(400, 200);
      expect(selection.clear).toHaveBeenCalled();
    });

    it("pinching never starts a selection", () => {
      fire(container, "touchstart", [pt(100, 100)]);
      fire(container, "touchstart", [pt(100, 100), pt(200, 200)]);
      vi.advanceTimersByTime(600);
      expect(selection.startAt).not.toHaveBeenCalled();
    });
  });

  it("touchcancel stops momentum", () => {
    flick(500, 260);
    fire(container, "touchcancel", []);
    onScroll.mockClear();
    vi.advanceTimersByTime(200);
    expect(onScroll).not.toHaveBeenCalled();
  });
});
