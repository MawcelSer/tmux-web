// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { setupWebglRenderer } from "../src/webgl-renderer.js";

function fakeAddon() {
  let lose = null;
  return {
    onContextLoss: vi.fn((cb) => (lose = cb)),
    dispose: vi.fn(),
    loseContext: () => lose(),
  };
}

function setup({ failLoad = false } = {}) {
  const addons = [];
  const term = {
    loadAddon: vi.fn(() => {
      if (failLoad) throw new Error("WebGL2 not supported");
    }),
  };
  const createAddon = () => {
    const addon = fakeAddon();
    addons.push(addon);
    return addon;
  };
  const renderer = setupWebglRenderer(term, { createAddon });
  return { term, addons, renderer };
}

describe("setupWebglRenderer", () => {
  it("loads the WebGL addon right away", () => {
    const { term, addons, renderer } = setup();
    expect(term.loadAddon).toHaveBeenCalledWith(addons[0]);
    expect(renderer.isActive()).toBe(true);
  });

  it("falls back to the DOM renderer when the context is lost", () => {
    const { addons, renderer } = setup();
    addons[0].loseContext();
    expect(addons[0].dispose).toHaveBeenCalled();
    expect(renderer.isActive()).toBe(false);
  });

  it("restores WebGL after a context loss", () => {
    const { term, addons, renderer } = setup();
    addons[0].loseContext();
    renderer.restore();
    expect(term.loadAddon).toHaveBeenLastCalledWith(addons[1]);
    expect(renderer.isActive()).toBe(true);
  });

  it("does not load a second addon while one is active", () => {
    const { term, renderer } = setup();
    renderer.restore();
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
  });

  it("disposes a load that failed half-way", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { addons, renderer } = setup({ failLoad: true });
    expect(addons[0].dispose).toHaveBeenCalled();
    expect(renderer.isActive()).toBe(false);
  });

  it("retries a failed load later (context not back yet)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { term, renderer } = setup({ failLoad: true });
    term.loadAddon.mockImplementation(() => {});
    renderer.restore();
    expect(renderer.isActive()).toBe(true);
  });

  it("gives up after repeated failures (no WebGL here)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { term, renderer } = setup({ failLoad: true });
    for (let i = 0; i < 5; i++) renderer.restore();
    expect(term.loadAddon).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(3);
  });
});
