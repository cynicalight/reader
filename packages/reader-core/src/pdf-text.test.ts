import { expect, it } from "vitest";
import { pdfFontAscent } from "./pdf-text";
it("falls back for zero or invalid ascent while honoring usable font metrics", () => {
  expect(pdfFontAscent({ ascent: 0, descent: 0 })).toBe(0.8);
  expect(pdfFontAscent({ ascent: 0, descent: -0.25 })).toBe(0.75);
  expect(pdfFontAscent({ ascent: 0.714 })).toBe(0.714);
  expect(pdfFontAscent({ ascent: NaN, descent: -2 })).toBe(0.8);
  expect(pdfFontAscent()).toBe(0.8);
});
