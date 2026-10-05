// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installEPUBScroll, type EPUBScrollState } from "./epub-scroll";
let cleanup: () => void;
let state: EPUBScrollState;
const turn = vi.fn(async (_direction: number) => {});
const error = vi.fn();
let active = true;
beforeEach(() => {
  state = { busy: false, locked: false, lastInput: 0, direction: 0 };
  active = true;
  document.body.innerHTML = "<p>Read me</p>";
  Object.defineProperty(document, "scrollingElement", {
    configurable: true,
    value: document.documentElement,
  });
  Object.defineProperties(document.documentElement, {
    scrollHeight: { configurable: true, value: 1800 },
    clientHeight: { configurable: true, value: 600 },
    scrollTop: { configurable: true, writable: true, value: 600 },
  });
  cleanup = installEPUBScroll(window, state, () => active, turn, error);
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.clearAllMocks();
});
function wheel(deltaY: number, target: Element = document.body) {
  const event = new WheelEvent("wheel", {
    deltaY,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}
it("keeps normal scrolling inside a chapter and moves forward/backward only at its boundary", async () => {
  expect(wheel(60).defaultPrevented).toBe(false);
  expect(turn).not.toHaveBeenCalled();
  document.documentElement.scrollTop = 1200;
  expect(wheel(60).defaultPrevented).toBe(true);
  expect(turn).toHaveBeenLastCalledWith(1);
  await vi.waitFor(() => expect(state.busy).toBe(false));
  document.documentElement.scrollTop = 0;
  wheel(-60);
  expect(turn).toHaveBeenLastCalledWith(-1);
});
it("does not skip short chapters under trackpad momentum or while a resource is loading", async () => {
  document.documentElement.scrollTop = 1200;
  let finish!: () => void;
  turn.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  wheel(60);
  wheel(30);
  expect(turn).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => expect(state.busy).toBe(false));
  cleanup();
  cleanup = installEPUBScroll(window, state, () => active, turn, error);
  wheel(20);
  expect(turn).toHaveBeenCalledTimes(1);
  state.lastInput = Date.now() - 200;
  wheel(60);
  expect(turn).toHaveBeenCalledTimes(2);
});
it("leaves nested scrolling, editing and text selection intact", () => {
  document.documentElement.scrollTop = 1200;
  const nested = document.createElement("pre");
  nested.style.overflowY = "auto";
  document.body.append(nested);
  Object.defineProperties(nested, {
    scrollHeight: { value: 300 },
    clientHeight: { value: 100 },
    scrollTop: { value: 40 },
  });
  expect(wheel(40, nested).defaultPrevented).toBe(false);
  const range = document.createRange();
  range.selectNodeContents(document.querySelector("p")!);
  window.getSelection()!.addRange(range);
  wheel(40);
  expect(turn).not.toHaveBeenCalled();
  window.getSelection()!.removeAllRanges();
  const input = document.createElement("textarea");
  document.body.append(input);
  wheel(40, input);
  expect(turn).not.toHaveBeenCalled();
});
it("supports vertical keyboard navigation without treating horizontal keys as chapter turns", () => {
  document.documentElement.scrollTop = 1200;
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(turn).not.toHaveBeenCalled();
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(turn).not.toHaveBeenCalled();
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "PageDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(turn).toHaveBeenCalledWith(1);
});
it("ignores inactive frames and removes listeners on disposal", () => {
  document.documentElement.scrollTop = 1200;
  active = false;
  wheel(40);
  active = true;
  cleanup();
  wheel(40);
  expect(turn).not.toHaveBeenCalled();
});
