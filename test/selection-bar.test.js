// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSelectionBar } from "../src/selection-bar.js";

describe("createSelectionBar", () => {
  let container;
  let handlers;
  let bar;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.replaceChildren(container);
    handlers = {
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onSelectScreen: vi.fn(),
      onClose: vi.fn(),
    };
    bar = createSelectionBar({ container, ...handlers });
  });

  afterEach(() => vi.useRealTimers());

  const button = (label) =>
    [...container.querySelectorAll(".selection-bar button")].find(
      (b) => b.textContent === label,
    );

  it("is hidden until shown", () => {
    expect(container.querySelector(".selection-bar").hidden).toBe(true);
    bar.show();
    expect(container.querySelector(".selection-bar").hidden).toBe(false);
  });

  it("wires Copy, Paste, Screen and close", () => {
    bar.show();
    button("Copy").click();
    button("Paste").click();
    button("Screen").click();
    button("✕").click();
    expect(handlers.onCopy).toHaveBeenCalled();
    expect(handlers.onPaste).toHaveBeenCalled();
    expect(handlers.onSelectScreen).toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("keeps the terminal from stealing the tap (no keyboard pop-up)", () => {
    bar.show();
    const ev = new Event("touchstart", { bubbles: true, cancelable: true });
    button("Copy").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("acts on touchend (a user gesture, needed for the clipboard)", () => {
    bar.show();
    button("Copy").dispatchEvent(new Event("touchstart", { cancelable: true }));
    expect(handlers.onCopy).not.toHaveBeenCalled();
    const end = new Event("touchend", { cancelable: true });
    button("Copy").dispatchEvent(end);
    expect(handlers.onCopy).toHaveBeenCalledTimes(1);
    expect(end.defaultPrevented).toBe(true); // no ghost click → no double copy
  });

  it("hide() hides it", () => {
    bar.show();
    bar.hide();
    expect(container.querySelector(".selection-bar").hidden).toBe(true);
  });

  it("toast() shows a short message that goes away", () => {
    bar.toast("Copied");
    const toast = container.querySelector(".selection-toast");
    expect(toast.textContent).toBe("Copied");
    expect(toast.hidden).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(toast.hidden).toBe(true);
  });
});
