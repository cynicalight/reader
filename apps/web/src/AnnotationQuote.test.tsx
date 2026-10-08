import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AnnotationQuote } from "./AnnotationQuote";
import type { PDFLocation } from "@reader/core";
const part = {
  blockId: "p1-b1",
  sourceHash: "h",
  sentenceIndex: 0,
  source: "An original sentence.",
  target: "完整译文句子。",
};
it("shows source above translation with the exact selected side preserved after reload", () => {
  const location: PDFLocation = JSON.parse(
    JSON.stringify({
      type: "pdf",
      page: 1,
      sentenceLink: { origin: "translation", parts: [part] },
    }),
  );
  const html = renderToStaticMarkup(
    <AnnotationQuote quote="译文" location={location} />,
  );
  expect(html).toContain("An original sentence.");
  expect(html).toContain("<span>译文</span>");
  expect(html).not.toContain("完整译文句子。");
  expect(html.indexOf("原文")).toBeLessThan(html.indexOf("译文"));
  const original = renderToStaticMarkup(
    <AnnotationQuote
      quote="original"
      location={{
        ...location,
        sentenceLink: { origin: "source", parts: [part] },
      }}
    />,
  );
  expect(original).toContain("完整译文句子。");
  expect(original).not.toContain("An original sentence.");
});
it("keeps existing unlinked annotations unchanged", () => {
  expect(
    renderToStaticMarkup(
      <AnnotationQuote quote="旧批注" location={{ type: "pdf", page: 1 }} />,
    ),
  ).toBe("旧批注");
});
