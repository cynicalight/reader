import { expect, it } from "vitest";
import { selectProcessingPages } from "./page-selection";
it("bounds a long book's extraction to the requested physical pages", () => {
  expect(selectProcessingPages(600, "301,302,303")).toEqual([301, 302, 303]);
  expect(selectProcessingPages(302, "301,302,303")).toEqual([301, 302]);
  expect(selectProcessingPages(600, "303,301,303")).toEqual([301, 303]);
});
it("rejects invalid bounded requests without expanding to the entire book", () => {
  for (const pages of ["", "0", "1.5", "-2", "1,,2", "1001", "301"])
    expect(() => selectProcessingPages(300, pages)).toThrow();
});
