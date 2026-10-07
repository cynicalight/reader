import { expect, it } from "vitest";
import type { Annotation, Message } from "@reader/core";
import { exportCounts, notesMarkdown } from "./notes-export";
import { paper } from "./papers/fixtures";

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
const doc = paper({
  title: "Attention",
  author: "Ada",
  metadata: { date: "2017", venue: "NeurIPS", doi: "10.1000/x" },
});
const data = {
  paperNote: "Main idea",
  messages: [
    { id: "m1", role: "user", content: "hi" },
    { id: "m2", role: "assistant", content: "Because **softmax**." },
  ] as Message[],
  annotations: [
    mark({ id: "b", kind: "bookmark", location: { type: "pdf", page: 3 } }),
    mark({
      id: "q",
      kind: "question",
      quote: "line two\nline three",
      note: "Why?",
      answerId: "m2",
      location: { type: "pdf", page: 2 },
    }),
    mark({ id: "h", quote: "key claim", location: { type: "pdf", page: 1 } }),
  ],
};

it("exports chosen parts in reading order with answers", () => {
  const md = notesMarkdown(
    doc,
    data,
    ["info", "paperNote", "highlights", "questions", "bookmarks"],
    (a) => `reader://open?id=p&annotation=${a.id}`,
  );
  expect(md).toBe(
    [
      "# Attention",
      "> Ada · 2017 · NeurIPS\n> DOI: 10.1000/x\n> https://doi.org/10.1000/x",
      "## 论文笔记",
      "Main idea",
      "## 批注",
      "### 第 1 页 · 划线 [↗](reader://open?id=p&annotation=h)\n\n> key claim",
      "### 第 2 页 · 问题 [↗](reader://open?id=p&annotation=q)\n\n> line two\n> line three\n\n**问：** Why?\n\n**AI 答：**\n\nBecause **softmax**.",
      "## 书签",
      "- [第 3 页](reader://open?id=p&annotation=b)",
    ].join("\n\n") + "\n",
  );
});

it("leaves out unchosen parts and counts what each part holds", () => {
  const md = notesMarkdown(doc, data, ["chat"]);
  expect(md).toContain("## AI 对话\n\n**我：**\n\nhi\n\n---\n\n**AI：**");
  expect(md).not.toContain("论文笔记");
  expect(md).not.toContain("批注");
  expect(exportCounts(data)).toEqual({
    info: 1,
    paperNote: 1,
    notes: 0,
    highlights: 1,
    questions: 1,
    bookmarks: 1,
    chat: 2,
  });
});
