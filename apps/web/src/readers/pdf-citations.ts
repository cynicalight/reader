import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PDFBlock, PDFLocation } from "@reader/core";
import { destinationPoint } from "./pdf-link-preview";

/** Resolve a translated citation against the original PDF's link annotation. */
export async function resolvePDFCitation(
  pdf: PDFDocumentProxy,
  block: PDFBlock,
  label: string,
): Promise<PDFLocation | undefined> {
  const page = await pdf.getPage(block.page);
  const view = page.getViewport({ scale: 1 });
  const [annotations, content] = await Promise.all([
    page.getAnnotations(),
    page.getTextContent(),
  ]);
  for (const annotation of annotations) {
    if (annotation.subtype !== "Link" || !annotation.dest || !annotation.rect)
      continue;
    const r = [
      ...view.convertToViewportPoint(annotation.rect[0], annotation.rect[1]),
      ...view.convertToViewportPoint(annotation.rect[2], annotation.rect[3]),
    ];
    const left = Math.min(r[0], r[2]),
      right = Math.max(r[0], r[2]);
    const top = Math.min(r[1], r[3]),
      bottom = Math.max(r[1], r[3]);
    if (
      right < block.bounds.x * view.width ||
      left > (block.bounds.x + block.bounds.width) * view.width ||
      bottom < block.bounds.y * view.height ||
      top > (block.bounds.y + block.bounds.height) * view.height
    )
      continue;
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => {
        const [x, y] = view.convertToViewportPoint(
          item.transform[4],
          item.transform[5],
        );
        if (
          y - item.height > bottom ||
          y < top ||
          x + item.width < left ||
          x > right
        )
          return "";
        const start = Math.max(
          0,
          Math.floor(((left - x) / (item.width || 1)) * item.str.length),
        );
        const end = Math.min(
          item.str.length,
          Math.ceil(((right - x) / (item.width || 1)) * item.str.length),
        );
        return item.str.slice(start, end);
      })
      .join("")
      .replace(/[\s\[\]]/g, "");
    if (text !== label) continue;
    const dest =
      typeof annotation.dest === "string"
        ? await pdf.getDestination(annotation.dest)
        : annotation.dest;
    if (!Array.isArray(dest) || !dest.length) continue;
    const index =
      typeof dest[0] === "number" ? dest[0] : await pdf.getPageIndex(dest[0]);
    const targetPage = await pdf.getPage(index + 1);
    const targetView = targetPage.getViewport({ scale: 1 });
    const point = destinationPoint(dest);
    const [x, y] = targetView.convertToViewportPoint(
      point.left ?? 0,
      point.top ?? targetView.viewBox[3],
    );
    return {
      type: "pdf",
      page: index + 1,
      x: Math.max(0, x / targetView.width),
      y: Math.max(0, y / targetView.height),
    };
  }
}

/** Fallback for PDFs that contain a numbered bibliography without link annotations. */
export function numberedReference(
  blocks: PDFBlock[],
  label: string,
): PDFLocation | undefined {
  for (const block of blocks) {
    if (!["reference", "reference_content"].includes(block.label)) continue;
    const lines = block.text.split("\n");
    for (const [index, line] of lines.entries()) {
      const number = /^\s*(?:\[(\d+)\]|(\d+)\.)\s/.exec(line);
      if ((number?.[1] ?? number?.[2]) === label)
        return {
          type: "pdf",
          page: block.page,
          x: block.bounds.x,
          y: block.bounds.y + (block.bounds.height * index) / lines.length,
        };
    }
  }
}
