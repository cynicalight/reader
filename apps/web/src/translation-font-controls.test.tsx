// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTheme } from "@reader/core";
import { TranslationFontControls } from "./TranslationFontControls";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
let root: Root, host: HTMLDivElement;
const setTheme = vi.fn();
const queryLocalFonts = vi.fn(async () => [
  { family: "PingFang SC" },
  { family: "LXGW WenKai" },
  { family: "PingFang SC" },
]);
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("queryLocalFonts", queryLocalFonts);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <TranslationFontControls
        theme={{ ...defaultTheme, translationFontFamily: "Kaiti SC" }}
        setTheme={setTheme}
      />,
    ),
  );
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

it("keeps a saved font, reads installed fonts once and toggles bold", async () => {
  expect(button("译文字体").textContent).toContain("Kaiti SC");
  await act(async () => button("读取本机字体").click());
  expect(queryLocalFonts).toHaveBeenCalledOnce();
  expect(button("读取本机字体")).toBeUndefined();
  await act(async () => button("译文字体").click());
  const options = [...document.querySelectorAll('[role="option"]')].map(
    (o) => o.textContent,
  );
  expect(options).toEqual([
    "黑体 / 无衬线",
    "宋体 / 衬线",
    "Kaiti SC",
    "LXGW WenKai",
    "PingFang SC",
  ]);
  await act(async () => button("译文加粗").click());
  expect(setTheme).toHaveBeenCalledWith({ translationFontWeight: "bold" });
});
