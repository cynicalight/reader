// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { SentenceHover } from "./sentence-hover";
let host: HTMLDivElement,
  hover: SentenceHover,
  registry: Map<string, Highlight>;
const range = () => {
  const r = document.createRange();
  r.selectNodeContents(host);
  return r;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  host = document.createElement("div");
  host.textContent = "sentence";
  registry = new Map();
  hover = new SentenceHover(
    host,
    "test",
    registry as unknown as HighlightRegistry,
  );
});
afterEach(() => {
  hover.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const alpha = () => Number(host.style.getPropertyValue("--test-hover"));
it("fades in, remains while stationary, then fades out before removing the range", () => {
  hover.show("first", [range()]);
  expect(alpha()).toBe(0);
  vi.advanceTimersByTime(80);
  expect(alpha()).toBeGreaterThan(0);
  expect(alpha()).toBeLessThan(1);
  vi.advanceTimersByTime(100);
  expect(alpha()).toBe(1);
  vi.advanceTimersByTime(5000);
  expect(registry.has("test-hover")).toBe(true);
  hover.clear();
  vi.advanceTimersByTime(80);
  expect(alpha()).toBeGreaterThan(0);
  expect(alpha()).toBeLessThan(1);
  expect(registry.has("test-hover")).toBe(true);
  vi.advanceTimersByTime(100);
  expect(registry.has("test-hover")).toBe(false);
});
it("refreshes geometry without restarting the fade, and crossfades a different sentence", () => {
  hover.show("first", [range()]);
  vi.advanceTimersByTime(200);
  const refreshed = range();
  hover.show("first", [refreshed]);
  expect(alpha()).toBe(1);
  expect(registry.get("test-hover")?.has(refreshed)).toBe(true);
  hover.show("second", [range()]);
  expect(registry.has("test-hover-out")).toBe(true);
  expect(alpha()).toBe(0);
  vi.advanceTimersByTime(200);
  expect(registry.has("test-hover-out")).toBe(false);
  expect(alpha()).toBe(1);
  hover.clear(true);
  expect(registry.size).toBe(0);
});
it("honors reduced motion and cleans up animation work on destruction", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  hover.show("first", [range()]);
  expect(alpha()).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  hover.clear();
  expect(registry.size).toBe(0);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  hover.show("second", [range()]);
  hover.destroy();
  expect(vi.getTimerCount()).toBe(0);
  expect(host.style.getPropertyValue("--test-hover")).toBe("");
});
