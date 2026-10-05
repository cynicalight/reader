import { expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { Locator } from "@readium/shared";
import { selectionLocator } from "./selection-locator";
it("stores an exact Readium DOM range for the second identical passage", () => {
  const dom = new JSDOM(
    "<body><p>The same words.</p><p>The same words.</p></body>",
  );
  const doc = dom.window.document;
  const paragraphs = doc.querySelectorAll("p");
  const base = Locator.deserialize({
    href: "chapter.xhtml",
    type: "application/xhtml+xml",
    text: { highlight: "The same words." },
  })!;
  const ranges = Array.from(paragraphs).map((p) => {
    const range = doc.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 15);
    return range;
  });
  const first = selectionLocator(base, ranges[0])!.serialize();
  const second = selectionLocator(base, ranges[1])!.serialize();
  expect(first.locations.domRange.start.cssSelector).not.toBe(
    second.locations.domRange.start.cssSelector,
  );
  const restored = Locator.deserialize(
    JSON.parse(JSON.stringify(second)),
  )!.serialize();
  const start = restored.locations.domRange.start;
  expect(doc.querySelector(start.cssSelector)).toBe(paragraphs[1]);
  expect(start.charOffset).toBe(0);
  expect(restored.text.highlight).toBe("The same words.");
  expect(first.locations.textRange).toEqual({ start: 0, end: 15 });
  expect(restored.locations.textRange).toEqual({ start: 15, end: 30 });
  dom.window.close();
});
