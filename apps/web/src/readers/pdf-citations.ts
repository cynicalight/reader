import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PDFBlock, PDFLocation } from "@reader/core";
import { destinationPoint } from "./pdf-link-preview";

// TextContent can merge differently colored links into an entire line. Use the
// PDF's glyph advances, distributing the line's remaining width over its spaces.
function characterWidths(
  item: { str: string; width: number; transform: number[] },
  font?: Map<string, number>,
) {
  const scale = Math.hypot(item.transform[0], item.transform[1]) / 1000;
  const ligatures = [...(font?.keys() ?? [])]
    .filter((key) => key.length > 1)
    .sort((a, b) => b.length - a.length);
  const chars: { text: string; width: number }[] = [];
  for (let i = 0; i < item.str.length;) {
    const text =
      ligatures.find((key) => item.str.startsWith(key, i)) ??
      String.fromCodePoint(item.str.codePointAt(i)!);
    chars.push({
      text,
      width: /\s/.test(text) ? 0 : (font?.get(text) ?? 500) * scale,
    });
    i += text.length;
  }
  const spaces = chars.filter((char) => /\s/.test(char.text)).length;
  const sum = chars.reduce((total, char) => total + char.width, 0);
  for (const char of chars) {
    if (/\s/.test(char.text))
      char.width = Math.max(0, (item.width - sum) / (spaces || 1));
    else if (!spaces || !font) char.width *= item.width / (sum || 1);
  }
  return chars;
}

/** Resolve a translated citation against the original PDF's link annotation. */
export async function resolvePDFCitation(
  pdf: PDFDocumentProxy,
  block: PDFBlock,
  label: string,
  operators?: Record<string, number>,
): Promise<PDFLocation | undefined> {
  const page = await pdf.getPage(block.page);
  const view = page.getViewport({ scale: 1 });
  const [annotations, content] = await Promise.all([
    page.getAnnotations(),
    page.getTextContent(),
  ]);
  const fonts = new Map<string, Map<string, number>>();
  if (operators) {
    const list = await page.getOperatorList();
    let font = "";
    const stack: string[] = [];
    for (let i = 0; i < list.fnArray.length; i++) {
      const op = list.fnArray[i],
        args = list.argsArray[i];
      if (op === operators.save) stack.push(font);
      else if (op === operators.restore) font = stack.pop() ?? font;
      else if (op === operators.setFont) font = args[0];
      else if (op === operators.showText) {
        let widths = fonts.get(font);
        if (!widths) fonts.set(font, (widths = new Map()));
        for (const glyph of args[0] as (
          number | { unicode: string; width: number }
        )[])
          if (typeof glyph !== "number" && glyph.unicode)
            widths.set(glyph.unicode, glyph.width);
      }
    }
  }
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
        if (y > bottom + 1 || y < top - 1 || x + item.width < left || x > right)
          return "";
        let cursor = x;
        return characterWidths(item, fonts.get(item.fontName))
          .map((char) => {
            const center = cursor + char.width / 2;
            cursor += char.width;
            return center >= left - 1 && center <= right + 1 ? char.text : "";
          })
          .join("");
      })
      .join("")
      .replace(/[\s\[\],，]/g, "");
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
