import { expect, it } from "vitest";
import { clampDetailWidth, resizeBoundary } from "./resize";

it("moves only the two columns on either side of a boundary", () => {
  const widths = { title: 400, authors: 160, year: 64 };
  expect(resizeBoundary(widths, "authors", "year", -30)).toEqual({
    authors: 130,
    year: 94,
  });
  // The title is flexible, so only its fixed neighbour is stored.
  expect(resizeBoundary(widths, "title", "authors", 50)).toEqual({
    authors: 110,
  });
});

it("stops at the minimum width of either column", () => {
  const widths = { title: 200, authors: 160, year: 64 };
  expect(resizeBoundary(widths, "authors", "year", 100)).toEqual({
    authors: 176,
    year: 48,
  });
  expect(resizeBoundary(widths, "title", "authors", -500)).toEqual({
    authors: 200,
  });
});

it("keeps the detail panel within its range", () => {
  expect(clampDetailWidth(100)).toBe(280);
  expect(clampDetailWidth(455.6)).toBe(456);
  expect(clampDetailWidth(2000)).toBe(720);
});
