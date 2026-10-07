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
  translationsDone: 0,
  translationsTotal: 10,
  detail: "",
  updatedAt: "",
};
it("shows learning first, then translation, and hides the panel after completion", () => {
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
  render({
    ...job,
    phase: "translating",
    pagesDone: 10,
    translationsDone: 3,
    translating: { status: "running", detail: "" },
  });
  expect(host.textContent).toContain("学习完成100%");
  act(() => vi.advanceTimersByTime(750));
  expect(host.textContent).toBe("翻译中3/10");
  expect(host.textContent).not.toContain("沉淀");
  expect(
    host.querySelectorAll('.processing-activity-dot[data-active="true"]'),
  ).toHaveLength(1);
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  render({
    ...job,
    phase: "ready",
    status: "complete",
    translationsDone: 10,
    translating: { status: "complete", detail: "" },
  });
  expect(host.textContent).toContain("翻译完成10/10");
  expect(host.querySelector(".processing-activity-dot")).toBeNull();
  expect(host.querySelectorAll(".processing-complete-icon")).toHaveLength(1);
  act(() => vi.advanceTimersByTime(750));
  expect(host.textContent).toBe("");
});
it("shows persisted translation progress and detail when a parsing warning exists", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{
          ...job,
          phase: "translating",
          translationsDone: 6,
          detail: "正在翻译正文 · 6 / 10 段",
          warning: "第 5 页有未归入版面块的文字，已保留。",
        }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("翻译中6/10");
  expect(
    host.querySelector(".cover-processing")?.getAttribute("title"),
  ).toContain("正在翻译正文 · 6 / 10 段");
});
it("keeps a configuration action without active glow while waiting", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onSettings = vi.fn();
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{
          ...job,
          phase: "translating",
          status: "waiting",
          translating: { status: "waiting", detail: "等待文字能力" },
        }}
        onSettings={onSettings}
      />,
    ),
  );
  expect(host.textContent).toContain("翻译待配置");
  expect(host.querySelector('[aria-label="等待 AI 配置"]')).not.toBeNull();
  expect(host.querySelector('[data-active="true"]')).toBeNull();
  act(() =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="等待 AI 配置"]')!
      .click(),
  );
  expect(onSettings).toHaveBeenCalledOnce();
});
it("offers a retry when translation fails", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{
          ...job,
          phase: "translating",
          status: "failed",
          translating: { status: "failed", detail: "文字服务失败" },
          translationsDone: 4,
        }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("翻译失败4/10");
  expect(host.querySelector('[aria-label="重试翻译"]')).not.toBeNull();
  expect(host.querySelector('[data-active="true"]')).toBeNull();
});
it("shows queued work distinctly from a running job at zero completed items", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{
          ...job,
          phase: "translating",
          status: "queued",
          translating: { status: "queued", detail: "" },
        }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("等待翻译0/10");
  expect(
    host.querySelector('[data-stage="translating"][data-active="true"]'),
  ).toBeNull();
});
it("omits completed translation that had no work", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{
          ...job,
          phase: "ready",
          status: "complete",
          pagesDone: 10,
          translationsTotal: 0,
          translating: { status: "complete", detail: "" },
        }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  expect(host.textContent).not.toContain("0/0");
});
