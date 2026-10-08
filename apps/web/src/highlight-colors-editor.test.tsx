// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTheme } from "@reader/core";
import { HighlightColorsEditor } from "./HighlightColorsEditor";
import { useReaderStore } from "./store";

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useReaderStore.setState({ theme: { ...defaultTheme } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<HighlightColorsEditor />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label,
  )!;
const palette = () => useReaderStore.getState().theme.highlightColors;

it("adds, edits, reorders and removes highlight colors", async () => {
  expect(host.querySelectorAll(".highlight-color-row")).toHaveLength(4);
  expect(button("恢复默认").disabled).toBe(true);
  await act(async () => button("添加颜色").click());
  expect(palette()?.at(-1)).toEqual({ value: "#a985e0", label: "新颜色" });
  const hex = host.querySelector<HTMLInputElement>(
    '[aria-label="颜色 5 的色值"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(hex, "#12345");
    hex.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(palette()?.at(-1)?.value).toBe("#a985e0");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(hex, "#123456");
    hex.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(palette()?.at(-1)?.value).toBe("#123456");
  await act(async () => button("上移新颜色").click());
  expect(palette()?.[3].label).toBe("新颜色");
  await act(async () => button("删除黄色").click());
  expect(palette()?.map((c) => c.label)).toEqual([
    "绿色",
    "蓝色",
    "新颜色",
    "红色",
  ]);
  await act(async () => button("恢复默认").click());
  expect(palette()?.map((c) => c.label)).toEqual([
    "黄色",
    "绿色",
    "蓝色",
    "红色",
  ]);
});
