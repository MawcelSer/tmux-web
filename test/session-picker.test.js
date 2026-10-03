import { describe, it, expect } from "vitest";
import { pickSession } from "../src/session-picker.js";

const s = (name, attached = false) => ({ name, attached });

describe("pickSession", () => {
  it("keeps the current session when it still exists", () => {
    expect(pickSession([s("a"), s("b", true)], "a")).toBeNull();
  });

  it("picks the attached session when none is selected", () => {
    expect(pickSession([s("a"), s("b", true)], "")).toBe("b");
  });

  it("falls back to the first session when none is attached", () => {
    expect(pickSession([s("a"), s("b")], "")).toBe("a");
  });

  it("replaces a session that no longer exists (stale localStorage, killed, exited)", () => {
    expect(pickSession([s("a"), s("b", true)], "gone")).toBe("b");
  });

  it("returns null when there are no sessions to pick", () => {
    expect(pickSession([], "gone")).toBeNull();
    expect(pickSession([], "")).toBeNull();
  });
});
