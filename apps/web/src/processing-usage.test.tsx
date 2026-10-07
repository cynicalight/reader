// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ProcessingUsage } from "@reader/core";
import { UsageDetails, combineUsageReports } from "./ProcessingUsage";
const total = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cachedInputTokens: 7,
  cacheWriteInputTokens: 0,
  reasoningOutputTokens: 2,
};
const report: ProcessingUsage = {
  historyComplete: true,
  total,
  calls: [
    {
      id: "one",
      stage: "settling",
      target: "p1-b1",
      provider: "codex",
      startedAt: "2026-10-06T00:00:00Z",
      finishedAt: "2026-10-06T00:00:10Z",
      status: "failed",
      models: [{ model: "actual", tokens: total }],
    },
  ],
  groups: [
    {
      stage: "settling",
      provider: "codex",
      model: "actual",
      calls: 1,
      unknownCalls: 0,
      tokens: total,
    },
  ],
  stages: [
    { stage: "learning", durationMs: 1000 },
    { stage: "settling", durationMs: 10000 },
    { stage: "translating", durationMs: 0 },
  ],
  unknownCalls: 0,
  failedCalls: 1,
  partialCalls: 1,
  elapsedMs: 11000,
};
it("shows actual models, stages, failure usage and cache subsets without adding them again", () => {
  const text = renderToStaticMarkup(<UsageDetails report={report} />);
  expect(text).toContain("15 tokens");
  expect(text).toContain("actual");
  expect(text).toContain("Codex");
  expect(text).toContain("沉淀／图片解析");
  expect(text).toContain("正文翻译");
  expect(text).not.toContain("学习／解析");
  expect(text).not.toContain("调用明细");
  expect(text).toContain("模型调用详情");
  expect(text).toContain("部分用量");
  expect(text).toContain("缓存读取 token");
  expect(text).toContain("关联调用累计耗时");
  const host = document.createElement("div");
  host.innerHTML = text;
  expect(host.querySelectorAll("tbody > tr")).toHaveLength(3);
  expect(host.querySelectorAll("details")).toHaveLength(3);
  expect(
    [...host.querySelectorAll("details")].every((item) => !item.open),
  ).toBe(true);
});
it("never represents missing or historical usage as zero tokens", () => {
  const unknown: ProcessingUsage = {
    ...report,
    historyComplete: false,
    total: { ...total, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    calls: [{ ...report.calls[0], models: [{ model: "", tokens: null }] }],
    groups: [{ ...report.groups[0], model: "", unknownCalls: 1 }],
    unknownCalls: 1,
    partialCalls: 0,
  };
  const text = renderToStaticMarkup(<UsageDetails report={unknown} />);
  expect(text).toContain("历史用量未记录");
  expect(text).toContain("用量未知");
  expect(text).toContain("模型未返回");
  expect(text).not.toContain("0 tokens");
});

it("adds chat below processing and combines totals without counting cache subsets twice", () => {
  const chatReport = {
    ...report,
    total,
    calls: [
      { ...report.calls[0], stage: "chat", target: "question" },
      { ...report.calls[0], id: "retry", stage: "chat", target: "question" },
    ],
    groups: report.groups.map((group) => ({ ...group, stage: "chat" })),
    stages: [{ stage: "chat", durationMs: 10000 }],
    elapsedMs: 10000,
  };
  const combined = combineUsageReports(report, chatReport);
  expect(combined.total.totalTokens).toBe(30);
  expect(combined.total.cachedInputTokens).toBe(14);
  expect(combined.elapsedMs).toBe(21000);
  const text = renderToStaticMarkup(<UsageDetails report={combined} />);
  const host = document.createElement("div");
  host.innerHTML = text;
  expect(host.querySelectorAll("tbody > tr")).toHaveLength(3);
  expect(text).toContain("1 次提问");
  expect(text).toContain("2 次调用");
  expect(text).toContain("累计执行耗时");
  expect(text).toContain("正文翻译");
  expect(text).toContain("沉淀／图片解析");
});
it("omits the removed consolidation row when it has no past usage", () => {
  const translated: ProcessingUsage = {
    ...report,
    calls: report.calls.map((call) => ({ ...call, stage: "translating" })),
    groups: report.groups.map((group) => ({ ...group, stage: "translating" })),
  };
  const text = renderToStaticMarkup(<UsageDetails report={translated} />);
  const host = document.createElement("div");
  host.innerHTML = text;
  expect(text).not.toContain("沉淀");
  expect(host.querySelectorAll("tbody > tr")).toHaveLength(2);
});
