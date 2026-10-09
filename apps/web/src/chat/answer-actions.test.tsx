// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnswerActions, COPIED_HOLD_MS } from "./AnswerActions";

const copyText = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./clipboard", () => ({ copyText }));

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  host.className = "chat-message assistant";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AnswerActions content="answer" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  copyText.mockClear();
});
const row = () => host.querySelector<HTMLElement>(".chat-message-actions")!;
const button = () => row().querySelector("button")!;

it("holds the copied check for 3s, then hides until the pointer leaves", async () => {
  await act(async () => button().click());
  expect(copyText).toHaveBeenCalledWith("answer");
  expect(row().hasAttribute("data-copied")).toBe(true);
  expect(button().getAttribute("aria-label")).toBe("已复制");

  await act(async () => vi.advanceTimersByTime(COPIED_HOLD_MS));
  expect(row().hasAttribute("data-copied")).toBe(false);
  expect(row().hasAttribute("data-dismissed")).toBe(true);
  expect(button().getAttribute("aria-label")).toBe("复制回答");

  await act(async () => host.dispatchEvent(new Event("pointerleave")));
  expect(row().hasAttribute("data-dismissed")).toBe(false);
});

it("restarts the hold on a repeated copy", async () => {
  await act(async () => button().click());
  await act(async () => vi.advanceTimersByTime(COPIED_HOLD_MS - 500));
  await act(async () => button().click());
  await act(async () => vi.advanceTimersByTime(COPIED_HOLD_MS - 500));
  expect(row().hasAttribute("data-copied")).toBe(true);
});

it("keeps the copy icon when copying fails", async () => {
  copyText.mockResolvedValueOnce(false);
  await act(async () => button().click());
  expect(row().hasAttribute("data-copied")).toBe(false);
  expect(button().getAttribute("aria-label")).toBe("复制回答");
});
