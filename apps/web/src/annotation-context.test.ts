import { expect, it } from "vitest";
import type { Annotation } from "@reader/core";
import { annotationContext, colorLabel, highlightPalette } from "./annotations";

const mark = (patch: Partial<Annotation>): Annotation => ({
  id: "x",
  documentId: "d",
  kind: "highlight",
  location: { type: "pdf", page: 1 },
  quote: "",
  note: "",
  color: "#e6b94c",
  createdAt: "2026-10-01",
  ...patch,
});

it("groups the reader's marks by color in reading order", () => {
  const text = annotationContext([
    mark({
      id: "b",
      quote: "E = mc^2",
      color: "#e8746b",
      location: { type: "pdf", page: 4 },
    }),
    mark({
      id: "a",
      quote: "F = ma",
      color: "#e8746b",
      location: { type: "pdf", page: 2 },
    }),
    mark({
      id: "n",
      kind: "note",
      quote: "claim",
      note: "check",
      location: { type: "pdf", page: 3 },
    }),
    mark({ id: "q", kind: "question", note: "why?", color: "#5b9fe8" }),
    mark({ id: "bm", kind: "bookmark", color: "#5b9fe8" }),
  ]);
  expect(text).toBe(
    [
      "[读者的标注，按颜色分组]",
      "蓝色（1 处）：",
      "- 第 1 页： —— 问题：why?",
      "红色（2 处）：",
      "- 第 2 页：“F = ma”",
      "- 第 4 页：“E = mc^2”",
      "黄色（1 处）：",
      "- 第 3 页：“claim” —— 笔记：check",
    ].join("\n"),
  );
  expect(colorLabel("#123456")).toBe("其他颜色");
  expect(annotationContext([mark({ kind: "bookmark" })])).toBe("");
});

it("bounds the context", () => {
  const many = Array.from({ length: 200 }, (_, i) =>
    mark({ id: String(i), quote: "x".repeat(100) }),
  );
  const text = annotationContext(many, 1000);
  expect(text.length).toBeLessThan(1020);
  expect(text.endsWith("（其余标注已省略）")).toBe(true);
});

it("names colors from the user's palette and keeps retired names", () => {
  const palette = [{ value: "#112233", label: "重点" }];
  expect(colorLabel("#112233", palette)).toBe("重点");
  expect(colorLabel("#a985e0", palette)).toBe("紫色");
  expect(highlightPalette({ highlightColors: [] })).toHaveLength(4);
  expect(highlightPalette({ highlightColors: palette })).toBe(palette);
});
