// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { openPasteBox } from "../src/paste-box.js";

describe("openPasteBox", () => {
  let container;
  let onSend;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.replaceChildren(container);
    onSend = vi.fn();
    openPasteBox({ container, onSend });
  });

  const box = () => container.querySelector(".paste-box");
  const button = (label) =>
    [...container.querySelectorAll(".paste-box button")].find(
      (b) => b.textContent === label,
    );

  it("shows a text box for the phone's native long-press → Paste", () => {
    const input = box().querySelector("textarea");
    expect(input).not.toBeNull();
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(document.activeElement).toBe(input);
  });

  it("Send passes the text on exactly and closes", () => {
    box().querySelector("textarea").value = "git log --oneline\n";
    button("Send").click();
    expect(onSend).toHaveBeenCalledWith("git log --oneline\n");
    expect(box()).toBeNull();
  });

  it("Send with nothing pasted just closes", () => {
    button("Send").click();
    expect(onSend).not.toHaveBeenCalled();
    expect(box()).toBeNull();
  });

  it("Cancel closes without sending", () => {
    box().querySelector("textarea").value = "x";
    button("Cancel").click();
    expect(onSend).not.toHaveBeenCalled();
    expect(box()).toBeNull();
  });

  it("only one box at a time", () => {
    openPasteBox({ container, onSend });
    expect(container.querySelectorAll(".paste-box")).toHaveLength(1);
  });
});
