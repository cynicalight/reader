import { expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PDFBlock } from "@reader/core";
import { numberedReference, resolvePDFCitation } from "./pdf-citations";
const block: PDFBlock = {
  id: "p1-b1",
  page: 1,
  label: "text",
  text: "See [6].",
  bounds: { x: 0, y: 0.3, width: 1, height: 0.3 },
};
it("resolves the original citation annotation to its exact PDF page and position", async () => {
  const view = {
    width: 600,
    height: 800,
    viewBox: [0, 0, 600, 800],
    convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
  };
  const page = {
    getViewport: () => view,
    getAnnotations: async () => [
      { subtype: "Link", dest: "cite.six", rect: [100, 500, 120, 512] },
    ],
    getTextContent: async () => ({
      items: [
        {
          str: "[6]",
          width: 20,
          height: 12,
          transform: [12, 0, 0, 12, 100, 500],
        },
      ],
    }),
  };
  const pdf = {
    getPage: vi.fn(async () => page),
    getDestination: vi.fn(async () => [
      { num: 12, gen: 0 },
      { name: "XYZ" },
      72,
      700,
    ]),
    getPageIndex: vi.fn(async () => 8),
  };
  expect(
    await resolvePDFCitation(pdf as unknown as PDFDocumentProxy, block, "6"),
  ).toEqual({ type: "pdf", page: 9, x: 0.12, y: 0.125 });
  expect(
    await resolvePDFCitation(pdf as unknown as PDFDocumentProxy, block, "7"),
  ).toBeUndefined();
});
it("only falls back to numbered bibliography blocks, preserving references within a multi-entry block", () => {
  const refs = {
    ...block,
    id: "p9-b1",
    page: 9,
    label: "reference_content",
    text: "[5] Five\n[6] Six",
  };
  expect(numberedReference([block, refs], "6")).toEqual({
    type: "pdf",
    page: 9,
    x: 0,
    y: 0.44999999999999996,
  });
  expect(numberedReference([block, refs], "8")).toBeUndefined();
});
