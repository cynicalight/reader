// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PDFBlock } from "@reader/core";
vi.mock("pdfjs-dist", () => ({
  Util: { transform: (_a: number[], b: number[]) => b },
}));
import { PDFReadingNavigation } from "./pdf-navigation";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const block = (
  id: string,
  x: number,
  y: number,
  height = 0.2,
  page = 1,
): PDFBlock => ({
  id,
  page,
  label: "text",
  text: id,
  bounds: { x, y, width: 0.4, height },
});
function setup() {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { value: 600 },
    clientHeight: { value: 600 },
    scrollWidth: { value: 1600 },
    scrollHeight: { value: 6000 },
  });
  host.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
  const blocks = [
    block("a", 0.1, 0.2),
    block("b", 0.1, 0.45),
    { ...block("image", 0.6, 0.2), text: "", image: "figure.png" },
    { ...block("footer", 0.1, 0.95, 0.02, 2), label: "footer" },
    block("last", 0.1, 0.2, 0.2, 3),
  ];
  const nodes = [1, 2, 3].map((n) => {
    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
      new DOMRect(
        200 - host.scrollLeft,
        200 + (n - 1) * 1600 - host.scrollTop,
        1000,
        1000,
      );
    return node;
  });
  const focus = vi.fn();
  const scaleWrites: string[] = [];
  const nav = new PDFReadingNavigation(
    host,
    {
      currentPageNumber: 1,
      currentScale: 1,
      set currentScaleValue(value: string) {
        scaleWrites.push(value);
      },
      getPageView: (n: number) => ({ div: nodes[n] }),
    } as unknown as PDFViewer,
    async () =>
      ({
        getViewport: () => ({ width: 1000, height: 1000, transform: [] }),
        getTextContent: async () => ({ items: [], styles: {} }),
      }) as unknown as PDFPageProxy,
    () => 3,
    () => blocks,
    { location: vi.fn(), selection: vi.fn() },
    focus,
  );
  return { host, nav, blocks, focus, scaleWrites };
}
async function settled(pending: Promise<unknown>) {
  await vi.advanceTimersByTimeAsync(600);
  return pending;
}
it("centers the focused paragraph, advances by blocks including images, and skips page furniture", async () => {
  const { nav, host, focus, scaleWrites } = setup();
  try {
    await settled(nav.fit());
    expect(host.scrollLeft).toBeCloseTo(200);
    expect(host.scrollTop).toBe(200);
    expect(focus).toHaveBeenLastCalledWith("a");
    const zoom = [...scaleWrites];
    await settled(nav.stepBlock(1));
    expect(focus).toHaveBeenLastCalledWith("b");
    expect(host.scrollTop).toBe(450);
    await settled(nav.stepBlock(1));
    expect(focus).toHaveBeenLastCalledWith("image");
    expect(host.scrollLeft).toBeCloseTo(700);
    await settled(nav.stepBlock(1));
    expect(focus).toHaveBeenLastCalledWith("last");
    await settled(nav.stepBlock(-1));
    expect(focus).toHaveBeenLastCalledWith("image");
    expect(scaleWrites).toEqual(zoom);
    nav.stop();
    expect(focus).toHaveBeenLastCalledWith(null);
  } finally {
    nav.destroy();
  }
});
it("click positioning is immediate and top-aligns a block taller than the viewport", async () => {
  const { nav, host, blocks, focus } = setup();
  try {
    await settled(nav.fit());
    blocks[1].bounds.height = 0.8;
    nav.focusBlock("b");
    expect(host.scrollTop).toBe(650);
    expect(host.scrollLeft).toBeCloseTo(200);
    expect(focus).toHaveBeenLastCalledWith("b");
    expect(nav.fitted).toBe(true);
  } finally {
    nav.destroy();
  }
});
it("switches after a wheel scroll crosses the midpoint, with no inertial cascade", async () => {
  const { nav, host, focus } = setup();
  try {
    await settled(nav.fit());
    const wheel = () =>
      host.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 30, cancelable: true }),
      );
    wheel();
    host.scrollTop = 301; // a bottom is now 299, above midpoint 300.
    host.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(64);
    expect(host.scrollTop).toBeGreaterThan(301);
    for (let i = 0; i < 12; i++) {
      wheel();
      await vi.advanceTimersByTimeAsync(32);
    }
    expect(focus).toHaveBeenLastCalledWith("b");
    expect(host.scrollTop).toBe(450);
    await vi.advanceTimersByTimeAsync(200);
    wheel();
    host.scrollTop = 551;
    host.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(600);
    expect(focus).toHaveBeenLastCalledWith("image");
  } finally {
    nav.destroy();
  }
});
it("pointer interruption cancels motion while retaining block mode for the next click", async () => {
  const { nav, host, focus } = setup();
  try {
    await settled(nav.fit());
    const pending = nav.stepBlock(1);
    await vi.advanceTimersByTimeAsync(96);
    host.dispatchEvent(new MouseEvent("pointerdown"));
    nav.focusBlock("image");
    await settled(pending);
    expect(nav.fitted).toBe(true);
    expect(focus).toHaveBeenLastCalledWith("image");
    expect(host.scrollLeft).toBeCloseTo(700);
    expect(host.scrollTop).toBe(200);
  } finally {
    nav.destroy();
  }
});

it("cleans up fitting insets when stopped between scale calculation and placement", async () => {
  const { nav, host, focus } = setup();
  try {
    const pending = nav.fit();
    await vi.advanceTimersByTimeAsync(1);
    expect(host.classList.contains("pdf-block-reading")).toBe(true);
    nav.stop();
    await settled(pending);
    expect(nav.fitted).toBe(false);
    expect(host.classList.contains("pdf-block-reading")).toBe(false);
    expect(focus).toHaveBeenLastCalledWith(null);
    expect(host.scrollTop).toBe(0);
  } finally {
    nav.destroy();
  }
});
it("does not move beyond the first/last block, and ignores reading controls after exit", async () => {
  const { nav, host, focus } = setup();
  try {
    await settled(nav.fit());
    await settled(nav.stepBlock(-1));
    expect(focus).toHaveBeenLastCalledWith("a");
    nav.focusBlock("last");
    await vi.advanceTimersByTimeAsync(1);
    const top = host.scrollTop;
    await settled(nav.stepBlock(1));
    expect(host.scrollTop).toBe(top);
    expect(focus).toHaveBeenLastCalledWith("last");
    nav.stop();
    expect(nav.focusBlock("a")).toBe(false);
    await settled(nav.stepBlock(-1));
    expect(host.scrollTop).toBe(top);
  } finally {
    nav.destroy();
  }
});
