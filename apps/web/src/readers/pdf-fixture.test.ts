import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
it("PDF.js reads the shipped PDF with outline and selectable text", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = await readFile(
    new URL("../../public/samples/reading-notes.pdf", import.meta.url),
  );
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  try {
    expect(pdf.numPages).toBe(2);
    expect((await pdf.getOutline())?.map((item) => item.title)).toEqual([
      "1. Start with a question",
      "2. Keep useful notes",
    ]);
    const page = await pdf.getPage(1);
    const text = await page.getTextContent();
    expect(
      text.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    ).toContain("A claim is not the same as evidence.");
  } finally {
    await task.destroy();
  }
});
