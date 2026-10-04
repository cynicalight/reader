// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import type { Document } from "@reader/core";
import { DocumentEditor } from "./DocumentManagement";
vi.mock("@reader/api", () => ({
  api: { update: vi.fn(), documents: vi.fn(), classify: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
let root: Root;
let host: HTMLDivElement;
let doc: Document;
const close = vi.fn();
async function render() {
  await act(async () =>
    root.render(
      <DocumentEditor document={doc} documents={[doc]} onClose={close} />,
    ),
  );
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  doc = {
    id: "doc",
    title: "Document",
    author: "",
    type: "pdf",
    size: 1,
    createdAt: "",
    lastOpenedAt: "",
    percentage: 0,
    favorite: false,
    category: "article",
    categorySource: "default",
    classificationStatus: "pending",
    classificationError: "",
    tags: ["Web"],
  };
  vi.mocked(api.update).mockImplementation(async () => doc);
  vi.mocked(api.documents).mockImplementation(async () => [doc]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("follows an AI category arriving while editing tags without marking it manual", async () => {
  await render();
  doc = {
    ...doc,
    category: "paper",
    categorySource: "ai",
    classificationStatus: "done",
  };
  await render();
  expect(
    document.querySelector('[aria-label="文档类型"]')?.textContent,
  ).toContain("论文");
  const remove = document.querySelector(
    '[aria-label="移除标签 Web"]',
  ) as HTMLButtonElement;
  await act(async () => remove.click());
  await click("保存");
  expect(api.update).toHaveBeenCalledWith("doc", { tags: [] });
  expect(close).toHaveBeenCalledOnce();
});
it("keeps an explicit manual choice when a late AI update arrives", async () => {
  await render();
  await click("确认采用此类型");
  doc = {
    ...doc,
    category: "paper",
    categorySource: "ai",
    classificationStatus: "done",
  };
  await render();
  expect(
    document.querySelector('[aria-label="文档类型"]')?.textContent,
  ).toContain("文章");
  await click("保存");
  expect(api.update).toHaveBeenCalledWith("doc", {
    category: "article",
    tags: ["Web"],
  });
});
