import { expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { Locator } from "@readium/shared";
import {
  selectionLocator,
  resolveEPUBRange,
  searchEPUBLocators,
} from "./selection-locator";
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

it("normalizes element endpoints across inline markup and paragraphs", () => {
  const dom = new JSDOM(
    "<body><p>前文<strong>中文😀</strong>结尾</p><p><a>next</a> é</p></body>",
  );
  const doc = dom.window.document;
  const selected = doc.createRange();
  selected.selectNodeContents(doc.body);
  const locator = selectionLocator(
    Locator.deserialize({
      href: "chapter.xhtml",
      type: "application/xhtml+xml",
    })!,
    selected,
  )!;
  const saved = Locator.deserialize(
    JSON.parse(JSON.stringify(locator.serialize())),
  )!;
  expect(saved.text?.highlight).toBe("前文中文😀结尾next é");
  expect(saved.locations.otherLocations?.get("textRange")).toEqual({
    start: 0,
    end: selected.toString().length,
  });
  expect(resolveEPUBRange(doc, saved)?.toString()).toBe(selected.toString());
  dom.window.close();
});
it("recovers a moved passage only when the quote is unambiguous", () => {
  const dom = new JSDOM("<body><p>Original passage</p></body>");
  const doc = dom.window.document;
  const selected = doc.createRange();
  selected.selectNodeContents(doc.querySelector("p")!);
  const locator = selectionLocator(
    Locator.deserialize({
      href: "chapter.xhtml",
      type: "application/xhtml+xml",
    })!,
    selected,
  )!;
  doc.body.insertAdjacentHTML("afterbegin", "<p>Inserted content</p>");
  expect(resolveEPUBRange(doc, locator)?.startContainer).toBe(
    doc.querySelectorAll("p")[1]!.firstChild,
  );
  doc.body.innerHTML =
    "<p>Inserted content</p><p>Original passage</p><p>Original passage</p>";
  expect(resolveEPUBRange(doc, locator)).toBeUndefined();
  doc.body.innerHTML = "<p>Text no longer exists</p>";
  expect(resolveEPUBRange(doc, locator)).toBeUndefined();
  dom.window.close();
});
it("does not use a stale DOM path when the same quote has different context", () => {
  const dom = new JSDOM(
    "<body><p>before one: repeated after one</p><p>before two: repeated after two</p></body>",
  );
  const doc = dom.window.document;
  const selected = doc.createRange();
  selected.setStart(doc.querySelectorAll("p")[1]!.firstChild!, 12);
  selected.setEnd(doc.querySelectorAll("p")[1]!.firstChild!, 20);
  const locator = selectionLocator(
    Locator.deserialize({
      href: "chapter.xhtml",
      type: "application/xhtml+xml",
    })!,
    selected,
  )!;
  doc.body.insertAdjacentHTML("afterbegin", "<p>Inserted</p>");
  const restored = resolveEPUBRange(doc, locator)!;
  expect(restored.startContainer).toBe(
    doc.querySelectorAll("p")[2]!.firstChild,
  );
  dom.window.close();
});
it("rejects empty selections and invalid saved selectors without throwing", () => {
  const dom = new JSDOM("<body><p>  </p></body>");
  const doc = dom.window.document;
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  const locator = Locator.deserialize({
    href: "chapter.xhtml",
    type: "application/xhtml+xml",
    locations: {
      domRange: {
        start: { cssSelector: "[", textNodeIndex: 0, charOffset: 0 },
      },
    },
    text: { highlight: "missing" },
  })!;
  expect(selectionLocator(locator, range)).toBeUndefined();
  expect(resolveEPUBRange(doc, locator)).toBeUndefined();
  dom.window.close();
});

it("returns distinct exact search results for case differences and repeated text", () => {
  const dom = new JSDOM("<body><p>Reader</p><p>reader</p><p>read.*</p></body>");
  const doc = dom.window.document;
  const base = Locator.deserialize({
    href: "chapter.xhtml",
    type: "application/xhtml+xml",
  })!;
  const results = searchEPUBLocators(doc, base, "READER");
  expect(results).toHaveLength(2);
  expect(
    results.map((locator) => resolveEPUBRange(doc, locator)?.startContainer),
  ).toEqual([
    doc.querySelectorAll("p")[0]!.firstChild,
    doc.querySelectorAll("p")[1]!.firstChild,
  ]);
  expect(searchEPUBLocators(doc, base, "read.*")).toHaveLength(1);
  expect(searchEPUBLocators(doc, base, "reader", 1)).toHaveLength(1);
  dom.window.close();
});
