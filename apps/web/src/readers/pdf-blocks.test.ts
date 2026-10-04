// @vitest-environment jsdom
import { expect, it } from "vitest";
import { PDFBlockOverlay, hitBlock } from "./pdf-blocks";
import type { PDFBlock } from "@reader/core";
const block: PDFBlock = {
  id: "p2-b1",
  page: 2,
  label: "chart",
  image: "assets/p2-b1.png",
  text: "",
  bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
};
it("hits normalized regions only on their source page", () => {
  expect(hitBlock([block], 2, 0.2, 0.3)?.id).toBe(block.id);
  expect(hitBlock([block], 1, 0.2, 0.3)).toBeUndefined();
  expect(hitBlock([block], 2, 0.8, 0.3)).toBeUndefined();
});
it("positions one non-interactive whole-block overlay and clears during selection, scroll and disposal", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<div class="page" data-page-number="2"><span>text layer</span></div>';
  const page = host.firstElementChild as HTMLElement;
  page.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 1000, height: 1400 }) as DOMRect;
  const layer = new PDFBlockOverlay(host);
  layer.setBlocks([block]);
  const target = page.firstElementChild!;
  target.dispatchEvent(
    new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 210,
      clientY: 440,
    }),
  );
  const overlay = page.querySelector<HTMLElement>(".reader-block-hover")!;
  expect(overlay.style.left).toBe("10%");
  expect(overlay.style.height).toBe("40%");
  expect(overlay.dataset.blockId).toBe(block.id);
  expect(overlay.getAttribute("aria-hidden")).toBe("true");
  target.dispatchEvent(
    new MouseEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      clientX: 210,
      clientY: 440,
    }),
  );
  expect(page.querySelector(".reader-block-hover")).toBeNull();
  target.dispatchEvent(
    new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 210,
      clientY: 440,
    }),
  );
  host.dispatchEvent(new Event("scroll"));
  expect(page.querySelector(".reader-block-hover")).toBeNull();
  layer.destroy();
  target.dispatchEvent(
    new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 210,
      clientY: 440,
    }),
  );
  expect(page.querySelector(".reader-block-hover")).toBeNull();
});
