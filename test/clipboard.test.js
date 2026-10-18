// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText, readClipboard } from "../src/clipboard.js";

function setSecure(secure, clipboard) {
  Object.defineProperty(window, "isSecureContext", {
    value: secure,
    configurable: true,
  });
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("copyText", () => {
  it("uses the Clipboard API on HTTPS", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setSecure(true, { writeText });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand on plain HTTP (no Clipboard API)", async () => {
    setSecure(false, undefined);
    let copied = null;
    document.execCommand = vi.fn(() => {
      copied = document.activeElement?.value?.slice(
        document.activeElement.selectionStart,
        document.activeElement.selectionEnd,
      );
      return true;
    });
    await expect(copyText("ls -la /tmp")).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe("ls -la /tmp");
    expect(document.querySelector("textarea")).toBeNull(); // cleaned up
  });

  it("falls back when the Clipboard API rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setSecure(true, { writeText: vi.fn().mockRejectedValue(new Error("no")) });
    document.execCommand = vi.fn(() => true);
    await expect(copyText("x")).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when nothing works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setSecure(false, undefined);
    document.execCommand = vi.fn(() => false);
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("restores focus to the element that had it", async () => {
    setSecure(false, undefined);
    document.execCommand = vi.fn(() => true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await copyText("x");
    expect(document.activeElement).toBe(input);
  });
});

describe("readClipboard", () => {
  it("reads text on HTTPS", async () => {
    setSecure(true, { readText: vi.fn().mockResolvedValue("pasted") });
    await expect(readClipboard()).resolves.toBe("pasted");
  });

  it("returns null when the page may not read the clipboard (HTTP)", async () => {
    setSecure(false, undefined);
    await expect(readClipboard()).resolves.toBeNull();
  });

  it("returns null when permission is denied", async () => {
    setSecure(true, {
      readText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    await expect(readClipboard()).resolves.toBeNull();
  });
});
