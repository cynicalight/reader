import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { readingColumns, type TextRun } from "./pdf-reading";

it("detects body columns in the checked-in Oze paper before any AI call", async () => {
  const { getDocument, Util } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(
      await readFile(
        new URL(
          "../../../../docs/66_VLDB25- Oze_ Decentralized Graph-based Concurrency Control for Long-running Update Transactions.pdf",
          import.meta.url,
        ),
      ),
    ),
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    for (const n of [2, 3]) {
      const page = await pdf.getPage(n),
        viewport = page.getViewport({ scale: 1 }),
        content = await page.getTextContent();
      const runs: TextRun[] = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        const t = Util.transform(viewport.transform, item.transform),
          h = Math.hypot(t[2], t[3]);
        return [
          {
            text: item.str,
            bounds: {
              x: t[4] / viewport.width,
              y:
                (t[5] - h * (content.styles[item.fontName]?.ascent ?? 0.8)) /
                viewport.height,
              width: Math.abs(item.width) / viewport.width,
              height: h / viewport.height,
            },
          },
        ];
      });
      const columns = readingColumns(runs);
      expect(
        columns.some((b) => b.x < 0.2 && b.width < 0.5),
        `page ${n} left column`,
      ).toBe(true);
      expect(
        columns.some((b) => b.x > 0.45 && b.width < 0.5),
        `page ${n} right column`,
      ).toBe(true);
    }
  } finally {
    await task.destroy();
  }
});
