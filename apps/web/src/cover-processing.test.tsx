// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Processing } from "@reader/core";
import { CoverProcessing } from "./ProcessingStatus";
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const job: Processing = {
  documentId: "test",
  phase: "learning",
  status: "running",
  pagesDone: 5,
  pagesTotal: 10,
  assetsDone: 0,
  assetsTotal: 4,
  detail: "",
  updatedAt: "",
};
it("shows one stage, completes it before advancing, and removes finished background work", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  root = createRoot(host);
  const render = (value: Processing) =>
    act(() =>
      root!.render(<CoverProcessing job={value} onSettings={() => {}} />),
    );
  render(job);
  expect(host.textContent).toContain("学习中50%");
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  render({ ...job, phase: "settling", pagesDone: 10, assetsDone: 1 });
  expect(host.textContent).toContain("学习完成100%");
  act(() => vi.advanceTimersByTime(750));
  expect(host.textContent).toContain("沉淀中25%");
  render({ ...job, phase: "ready", status: "complete", assetsDone: 4 });
  expect(host.textContent).toContain("沉淀完成100%");
  act(() => vi.advanceTimersByTime(750));
  expect(host.textContent).toBe("");
});
it("keeps a configuration action without active glow while waiting", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{ ...job, phase: "settling", status: "waiting" }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("等待 AI 配置");
  expect(host.querySelector('[data-active="true"]')).toBeNull();
});
