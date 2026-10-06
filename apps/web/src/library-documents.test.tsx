// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import type { Document } from "@reader/core";
import { LibraryDocuments } from "./LibraryDocuments";
import { useReaderStore } from "./store";
vi.mock("@reader/api", () => ({
  api: {
    removeDocument: vi.fn(),
    processingUsage: vi.fn(),
    chatUsage: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./ProcessingStatus", () => ({ CoverProcessing: () => null }));
const docs: Document[] = ["Alpha", "Beta"].map((title, i) => ({
  id: String(i),
  title,
  author: "",
  type: "epub",
  category: "book",
  categorySource: "manual",
  classificationStatus: "done",
  classificationError: "",
  tags: [],
  size: 100,
  createdAt: "",
  lastOpenedAt: "",
  favorite: false,
  percentage: 0,
}));
let root: Root, host: HTMLDivElement;
const open = vi.fn(),
  edit = vi.fn();
function Harness() {
  const documents = useReaderStore((s) => s.documents);
  return (
    <LibraryDocuments
      documents={documents}
      libraryView="grid"
      jobs={[]}
      processingError=""
      openDocument={open}
      favorite={() => {}}
      onEdit={edit}
      onSettings={() => {}}
    />
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  vi.mocked(api.chatUsage).mockResolvedValue({
    historyComplete: true,
    total: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      reasoningOutputTokens: null,
    },
    calls: [],
    groups: [],
    stages: [{ stage: "chat", durationMs: 0 }],
    unknownCalls: 0,
    failedCalls: 0,
    partialCalls: 0,
    elapsedMs: 0,
  });
  useReaderStore.setState({ documents: docs });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
it("selects all current results and waits for explicit confirmation before deleting", async () => {
  await act(async () => button("编辑").click());
  await act(async () =>
    host.querySelector("article")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(host.textContent).toContain("已选 2 份");
  await act(async () => button("删除所选").click());
  expect(api.removeDocument).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "删除 2 份文档",
  );
  vi.mocked(api.removeDocument).mockImplementation(async (id) => {
    if (id === "1") throw Error("offline");
  });
  await act(async () => button("删除文档").click());
  expect(useReaderStore.getState().documents.map((d) => d.id)).toEqual(["1"]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "删除 1 份文档",
  );
  expect(open).not.toHaveBeenCalled();
  vi.mocked(api.removeDocument).mockResolvedValue(undefined);
  await act(async () => button("删除文档").click());
  expect(useReaderStore.getState().documents).toEqual([]);
});
it("opens the context menu on the targeted document and edits that document", async () => {
  const card = host.querySelectorAll("article")[1];
  await act(async () =>
    card.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
      }),
    ),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.includes("编辑文档信息"));
  expect(item).toBeDefined();
  await act(async () => item!.click());
  expect(edit).toHaveBeenCalledExactlyOnceWith("1");
  expect(open).not.toHaveBeenCalled();
});

it("requires edit mode before selecting and clears selection on exit", async () => {
  const shortcut = () =>
    host.querySelector("article")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  await act(async () => {
    shortcut();
  });
  expect(host.textContent).not.toContain("已选");
  await act(async () => button("编辑").click());
  await act(async () => {
    shortcut();
  });
  expect(host.textContent).toContain("已选 2 份");
  await act(async () => button("完成").click());
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  await act(async () => button("编辑").click());
  expect(host.textContent).toContain("已选 0 份");
});

it("opens PDF processing statistics from the button beside edit without opening the book", async () => {
  const pdf = { ...docs[0], type: "pdf" as const };
  const job = {
    documentId: pdf.id,
    phase: "ready" as const,
    status: "complete" as const,
    pagesDone: 2,
    pagesTotal: 2,
    assetsDone: 0,
    assetsTotal: 0,
    translationsDone: 18,
    translationsTotal: 18,
    detail: "",
    updatedAt: "",
  };
  vi.mocked(api.processingUsage).mockResolvedValue({
    historyComplete: false,
    total: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    },
    calls: [],
    groups: [],
    stages: [],
    unknownCalls: 0,
    failedCalls: 0,
    partialCalls: 0,
    elapsedMs: 0,
  });
  await act(async () =>
    root.render(
      <LibraryDocuments
        documents={[pdf, docs[1]]}
        libraryView="grid"
        jobs={[job]}
        processingError=""
        openDocument={open}
        favorite={() => {}}
        onEdit={edit}
        onSettings={() => {}}
      />,
    ),
  );
  const button = host.querySelector<HTMLButtonElement>(
    'button[aria-label="查看 Alpha 的用量统计"]',
  )!;
  expect(button).not.toBeNull();
  expect(button.nextElementSibling?.getAttribute("aria-label")).toBe(
    "编辑 Alpha 的信息",
  );
  expect(
    host.querySelector('button[aria-label="查看 Beta 的用量统计"]'),
  ).not.toBeNull();
  await act(async () => button.click());
  expect(api.processingUsage).toHaveBeenCalledWith(pdf.id);
  expect(open).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "历史用量未记录",
  );
});
