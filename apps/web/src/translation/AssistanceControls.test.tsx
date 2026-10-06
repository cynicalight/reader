// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Processing } from "@reader/core";
import { AssistanceControls } from "./AssistanceControls";
import { api } from "@reader/api";
vi.mock("@reader/api", () => ({
  api: {
    assistance: vi.fn(async () => undefined),
    setAssistance: vi.fn(),
    aiConfig: vi.fn(async () => ({ primary: "codex" })),
  },
}));
let root: Root, host: HTMLDivElement;
const paused: Processing = {
  documentId: "book",
  phase: "learning",
  status: "paused",
  enabled: false,
  pagesDone: 0,
  pagesTotal: 0,
  assetsDone: 0,
  assetsTotal: 0,
  translationsDone: 0,
  translationsTotal: 0,
  detail: "辅助阅读未开启",
  updatedAt: "2026-10-07T00:00:00Z",
};
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});
async function render(page: number, processing: Processing = paused) {
  await act(async () =>
    root.render(
      <AssistanceControls
        documentId="book"
        page={page}
        processing={processing}
      />,
    ),
  );
}
it("opening and changing pages do not authorize processing", async () => {
  await render(1);
  await render(40);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(api.setAssistance).not.toHaveBeenCalled();
  expect(host.textContent).toContain("开启辅助阅读");
  vi.mocked(api.setAssistance).mockResolvedValue({
    ...paused,
    enabled: true,
    mode: "reading",
    pageStart: 40,
    pageEnd: 42,
    status: "queued",
    updatedAt: "2026-10-07T00:00:01Z",
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(api.setAssistance).toHaveBeenCalledWith("book", "reading", 40);
  expect(host.textContent).toContain("暂停辅助阅读");
});
it("debounces navigation to the latest reading page after consent", async () => {
  const running: Processing = {
    ...paused,
    enabled: true,
    mode: "reading",
    pageStart: 1,
    pageEnd: 3,
    status: "complete",
  };
  vi.mocked(api.setAssistance).mockImplementation(
    async (_id, _action, page) => ({
      ...running,
      pageStart: page,
      pageEnd: page + 2,
      updatedAt: "2026-10-07T00:00:02Z",
    }),
  );
  await render(1, running);
  await render(10, running);
  await render(50, running);
  await act(async () => vi.advanceTimersByTime(600));
  expect(api.setAssistance).toHaveBeenCalledTimes(1);
  expect(api.setAssistance).toHaveBeenCalledWith("book", "follow", 50);
});
it("a paused whole-book job resumes instead of restarting its scope", async () => {
  const job: Processing = {
    ...paused,
    mode: "full",
    pageStart: 40,
    pageEnd: 42,
  };
  vi.mocked(api.setAssistance).mockResolvedValue({
    ...job,
    enabled: true,
    status: "queued",
  });
  await render(7, job);
  expect(host.textContent).toContain("继续整本处理");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(api.setAssistance).toHaveBeenCalledWith("book", "resume", 7);
});
