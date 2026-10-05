// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { Annotation, TranslationBlock } from "@reader/core";
import { textRange, translatedAnnotationRanges } from "./annotations";

it("restores a translated mark across formatted text nodes without changing text", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<section data-translation-block="p1-b1">这是<strong>重要</strong>的一句。下一句。</section>';
  const node = host.firstElementChild as HTMLElement;
  expect(textRange(node, 2, 6)?.toString()).toBe("重要的一");
  const translation: TranslationBlock = {
    blockId: "p1-b1",
    sourceHash: "same-source",
    status: "complete",
    sentences: [
      { source: "An important sentence.", target: "这是重要的一句。" },
    ],
  };
  const annotation: Annotation = {
    id: "a",
    documentId: "doc",
    kind: "highlight",
    quote: "重要的一",
    note: "",
    color: "#e6b94c",
    createdAt: "",
    location: {
      type: "pdf",
      page: 1,
      translation: {
        blockId: "p1-b1",
        sourceHash: "same-source",
        sentenceIndexes: [0],
        start: 2,
        end: 6,
      },
    },
  };
  expect(
    translatedAnnotationRanges(
      host,
      [annotation],
      [translation],
    )[0].range.toString(),
  ).toBe("重要的一");
  expect(host.textContent).toBe("这是重要的一句。下一句。");
  expect(
    translatedAnnotationRanges(
      host,
      [annotation],
      [{ ...translation, sourceHash: "changed" }],
    ),
  ).toEqual([]);
  node.textContent = "内容已经变动。";
  expect(translatedAnnotationRanges(host, [annotation], [translation])).toEqual(
    [],
  );
});
