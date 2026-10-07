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
  translationsDone: 0,
  translationsTotal: 10,
  detail: "",
  updatedAt: "",
};
it("shows learning first, then both parallel jobs, and hides the panel after completion", () => {
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
    phase: "settling",
    pagesDone: 10,
    assetsDone: 1,
    translationsDone: 3,
    settling: { status: "running", detail: "" },
    translating: { status: "running", detail: "" },
  });
  expect(host.textContent).toContain("学习完成100%");
  act(() => vi.advanceTimersByTime(750));
  expect(host.textContent).toContain("沉淀中1/4");
  expect(host.textContent).toContain("翻译中3/10");
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  render({
    ...job,
    phase: "translating",
    assetsDone: 4,
    translationsDone: 3,
    settling: { status: "complete", detail: "" },
    translating: { status: "running", detail: "" },
  });
  expect(host.textContent).toContain("沉淀完成4/4");
  expect(host.textContent).toContain("翻译中3/10");
  expect(
    host.querySelector(".cover-processing")?.getAttribute("data-leaving"),
  ).toBe("false");
  render({
    ...job,
    phase: "ready",
    status: "complete",
    assetsDone: 4,
    translationsDone: 10,
    settling: { status: "complete", detail: "" },
    translating: { status: "complete", detail: "" },
  });
  expect(host.textContent).toContain("翻译完成10/10");
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
        job={{ ...job, phase: "settling", status: "waiting" }}
        onSettings={onSettings}
      />,
    ),
  );
  expect(host.querySelector('[aria-label="等待 AI 配置"]')).not.toBeNull();
  expect(host.querySelector('[data-active="true"]')).toBeNull();
  act(() =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="等待 AI 配置"]')!
      .click(),
  );
  expect(onSettings).toHaveBeenCalledOnce();
});

it("uses independent states when translation is active while consolidation waits", async () => {
  const { processingStages } = await import("./ProcessingStatus");
  const stages = processingStages({
    ...job,
    phase: "translating",
    settling: { status: "waiting", detail: "等待图片能力" },
    translating: { status: "running", detail: "正在翻译" },
    translationsDone: 4,
  });
  expect(stages[1].done).toBe(false);
  expect(stages[1].active).toBe(false);
  expect(stages[2].active).toBe(true);
  expect(stages[2].count).toBe("4 / 10 段");
});
it("keeps the cover on unfinished consolidation when translation has completed", async () => {
  const { processingStages } = await import("./ProcessingStatus");
  const stages = processingStages({
    ...job,
    phase: "settling",
    settling: { status: "running", detail: "正在沉淀" },
    translating: { status: "complete", detail: "翻译完成" },
    translationsDone: 10,
  });
  expect(stages[1].active).toBe(true);
  expect(stages[1].done).toBe(false);
  expect(stages[2].done).toBe(true);
});

it("exposes a failed lane while the other keeps running", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{
          ...job,
          phase: "translating",
          settling: { status: "failed", detail: "图片服务失败" },
          translating: { status: "running", detail: "" },
          translationsDone: 4,
        }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("沉淀失败0/4");
  expect(host.textContent).toContain("翻译中4/10");
  expect(host.querySelector('[aria-label="重试沉淀"]')).not.toBeNull();
  expect(
    host.querySelector('[data-stage="translating"][data-active="true"]'),
  ).not.toBeNull();
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
          phase: "settling",
          settling: { status: "queued", detail: "" },
          translating: { status: "running", detail: "" },
        }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("等待沉淀0/4");
  expect(host.textContent).toContain("翻译中0/10");
  expect(
    host.querySelector('[data-stage="settling"][data-active="true"]'),
  ).toBeNull();
});

it("omits a completed lane that has no work", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root!.render(
      <CoverProcessing
        job={{
          ...job,
          phase: "translating",
          assetsTotal: 0,
          settling: { status: "complete", detail: "" },
          translating: { status: "running", detail: "" },
        }}
        onSettings={() => {}}
      />,
    ),
  );
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  expect(host.textContent).not.toContain("0/0");
});
