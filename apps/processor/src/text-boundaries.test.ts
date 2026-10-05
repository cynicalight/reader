import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { repairTextBlocks } from "./repair";
import { assignText } from "./layout";
import { extractTextSpans } from "./text";
import blocks from "./fixtures/oze-page7.json";

it("keeps Record's final line inside its unchanged hover box in the actual Oze PDF", async () => {
  const task = getDocument({
    data: new Uint8Array(
      await readFile(
        new URL(
          "../../../docs/66_VLDB25- Oze_ Decentralized Graph-based Concurrency Control for Long-running Update Transactions.pdf",
          import.meta.url,
        ),
      ),
    ),
    useSystemFonts: true,
  });
  try {
    const page = await (await task.promise).getPage(7);
    const texts = assignText(blocks, await extractTextSpans(page, 2)).texts;
    expect(texts[1]).toMatch(/^Record:/);
    expect(texts[1]).toMatch(/and the status\.$/);
    expect(texts[3]).toMatch(/^Graph:/);
    expect(texts[3]).toContain("whose key is txid");
    expect(texts[4]).toMatch(/write protocols in the read phase below\.$/);
    expect(texts[5]).toMatch(/^Lines 1/);
    const originals = blocks.map((b) => ({ ...b, page: 7, text: "old text" }));
    const repaired = await repairTextBlocks(await task.promise, originals);
    expect(repaired.blocks.map((b) => b.id)).toEqual([
      "p7-b2",
      "p7-b3",
      "p7-b5",
      "p7-b4",
      "p7-b6",
      "p7-b7",
    ]);
    for (const original of originals)
      expect(repaired.blocks.find((b) => b.id === original.id)?.bounds).toEqual(
        original.bounds,
      );
    expect(originals.every((b) => b.text === "old text")).toBe(true);
  } finally {
    await task.destroy();
  }
});
