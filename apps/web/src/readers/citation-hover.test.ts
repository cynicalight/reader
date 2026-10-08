// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installCitationHover } from "./citation-hover";
import { PDFLinkPreview } from "./pdf-link-preview";
import type { PDFDocumentProxy } from "pdfjs-dist";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("previews a translated citation without navigating and discards a late resolution after leaving", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  host.innerHTML = '<a href="#reader-citation?block=p1-b1&label=6">6</a>';
  document.body.append(host);
  const anchor = host.querySelector("a")!;
  const target = { type: "pdf" as const, page: 9, y: 0.4 };
  const show = vi.fn(async () => {}),
    hide = vi.fn();
  let finish!: (value: typeof target) => void;
  const resolve = vi.fn(
    () =>
      new Promise<typeof target>((done) => {
        finish = done;
      }),
  );
  const cleanup = installCitationHover(host, resolve, show, hide);
  anchor.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(300);
  expect(resolve).toHaveBeenCalledWith("p1-b1", "6");
  anchor.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  finish(target);
  await Promise.resolve();
  expect(show).not.toHaveBeenCalled();
  anchor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(300);
  finish(target);
  await Promise.resolve();
  expect(show).toHaveBeenCalledWith(target, anchor);
  host.dispatchEvent(new Event("scroll"));
  expect(hide).toHaveBeenCalledTimes(2);
  cleanup();
});

it("recognizes current PDF.js internal-link annotations for hover and preserves native click navigation", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  host.innerHTML =
    '<div class="annotationLayer"><section data-internal-link><a href="#cite.six">6</a></section></div>';
  document.body.append(host);
  const getDestination = vi.fn(async () => null);
  const follow = vi.fn();
  const preview = new PDFLinkPreview(
    host,
    () => ({ getDestination }) as unknown as PDFDocumentProxy,
    vi.fn(),
    follow,
  );
  const anchor = host.querySelector("a")!;
  anchor.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(300);
  expect(getDestination).toHaveBeenCalledWith("cite.six");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  expect(follow).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(false);
  preview.destroy();
});
