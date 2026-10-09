// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import type { Annotation, Message } from "@reader/core";
import { NotesPanel, documentOrder } from "./NotesPanel";
import { paper } from "./papers/fixtures";
vi.mock("@reader/api", () => ({
  api: {
    documentNote: vi.fn(async () => ({ body: "" })),
    saveDocumentNote: vi.fn(async (_id: string, body: string) => ({ body })),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const mark = (patch: Partial<Annotation>): Annotation => ({
  id: "x",
  documentId: "p",
  kind: "highlight",
  location: { type: "pdf", page: 1 },
  quote: "",
  note: "",
  color: "#e6b94c",
  createdAt: "2026-10-01",
  ...patch,
});
const annotations = [
  mark({
    id: "late",
    quote: "page two",
    location: {
      type: "pdf",
      page: 2,
      rects: [{ x: 0, y: 0.1, width: 1, height: 0.1 }],
    },
  }),
  mark({
    id: "q-open",
    kind: "question",
    quote: "Why?",
    note: "Why does this converge?",
    location: {
      type: "pdf",
      page: 1,
      rects: [{ x: 0, y: 0.5, width: 1, height: 0.1 }],
    },
  }),
  mark({
    id: "q-done",
    kind: "question",
    note: "What is p?",
    answerId: "m1",
    location: {
      type: "pdf",
      page: 1,
      rects: [{ x: 0, y: 0.2, width: 1, height: 0.1 }],
    },
  }),
  mark({
    id: "note",
    kind: "note",
    quote: "a claim",
    note: "Check this",
    location: {
      type: "pdf",
      page: 1,
      rects: [{ x: 0, y: 0.05, width: 1, height: 0.1 }],
    },
  }),
];
const messages = [
  { id: "m1", role: "assistant", content: "**p** is the *probability*." },
] as Message[];
let root: Root, host: HTMLDivElement;
const handlers = {
  onGo: vi.fn(),
  onDelete: vi.fn(),
  onSave: vi.fn(async () => true),
  onAnswer: vi.fn(),
  onResolve: vi.fn(),
  onShowAnswer: vi.fn(),
  onExport: vi.fn(),
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <NotesPanel
        document={paper({ id: "p" })}
        annotations={annotations}
        messages={messages}
        deleting={new Set()}
        answering={new Set()}
        {...handlers}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const cards = () =>
  [...host.querySelectorAll<HTMLElement>(".note-card")].map(
    (card) => card.querySelector(".note-quote")!.textContent,
  );
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim().startsWith(label) || b.ariaLabel === label,
  )!;
const type = (el: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

it("lists records in reading order", () => {
  expect(cards()).toEqual(["a claim", "第 1 页", "Why?", "page two"]);
  expect([...annotations].sort(documentOrder).map((a) => a.id)).toEqual([
    "note",
    "q-done",
    "q-open",
    "late",
  ]);
});

it("edits a note in place", async () => {
  await act(async () => button("编辑批注").click());
  const field = host.querySelector<HTMLTextAreaElement>('[aria-label="批注"]')!;
  await act(async () => type(field, "Checked twice"));
  const tags = host.querySelector<HTMLInputElement>('[aria-label="标签"]')!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(tags, "#method, proof method");
  await act(async () =>
    tags.dispatchEvent(new Event("input", { bubbles: true })),
  );
  await act(async () => button("保存").click());
  expect(handlers.onSave).toHaveBeenCalledWith(annotations[3], {
    note: "Checked twice",
    tags: ["method", "proof"],
  });
  expect(host.querySelector('[aria-label="批注"]')).toBeNull();
});

it("saves the paper note after typing stops", async () => {
  await act(async () => button("论文笔记").click());
  const field = host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="论文笔记"]',
  )!;
  await act(async () => type(field, "Main contribution"));
  expect(api.saveDocumentNote).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(900));
  expect(api.saveDocumentNote).toHaveBeenCalledExactlyOnceWith(
    "p",
    "Main contribution",
  );
});
