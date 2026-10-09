// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  installEPUBPaging,
  installEPUBScroll,
  type EPUBScrollState,
} from "./epub-scroll";
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

function key(name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}
it("turns one page per wheel gesture and never lets pages scroll natively", async () => {
  cleanup();
  cleanup = installEPUBPaging(window, state, () => active, turn, error);
  // Mid-chapter: paging ignores the scroll position entirely.
  document.documentElement.scrollTop = 600;
  expect(wheel(40).defaultPrevented).toBe(true);
  expect(turn).toHaveBeenLastCalledWith(1);
  await vi.waitFor(() => expect(state.busy).toBe(false));
  // Momentum from the same gesture, including tiny tail deltas, is swallowed.
  wheel(30);
  expect(wheel(2).defaultPrevented).toBe(true);
  expect(turn).toHaveBeenCalledOnce();
  // A horizontal trackpad swipe reads its dominant axis.
  state.lastInput = Date.now() - 200;
  document.body.dispatchEvent(
    new WheelEvent("wheel", {
      deltaX: -50,
      deltaY: 5,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(turn).toHaveBeenLastCalledWith(-1);
});
it("turns pages from arrow, page and space keys, one per press", async () => {
  cleanup();
  cleanup = installEPUBPaging(window, state, () => active, turn, error);
  expect(key("ArrowRight").defaultPrevented).toBe(true);
  expect(turn).toHaveBeenLastCalledWith(1);
  await vi.waitFor(() => expect(state.busy).toBe(false));
  key("ArrowLeft");
  expect(turn).toHaveBeenLastCalledWith(-1);
  await vi.waitFor(() => expect(state.busy).toBe(false));
  key(" ", { shiftKey: true });
  expect(turn).toHaveBeenLastCalledWith(-1);
  expect(turn).toHaveBeenCalledTimes(3);
  // Shortcuts and editing keep their own meaning.
  key("ArrowRight", { metaKey: true });
  const input = document.createElement("textarea");
  document.body.append(input);
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  expect(turn).toHaveBeenCalledTimes(3);
});
it("leaves scrolling frames to the scroll handler", () => {
  cleanup();
  active = false;
  cleanup = installEPUBPaging(window, state, () => active, turn, error);
  expect(wheel(40).defaultPrevented).toBe(false);
  expect(key("ArrowRight").defaultPrevented).toBe(false);
  expect(turn).not.toHaveBeenCalled();
});
