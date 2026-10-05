import { expect, it } from "vitest";
import { ReadingSync } from "./pdf-reading";

it("never feeds programmatic scrolling back and transfers control on user input", () => {
  const sync = new ReadingSync();
  sync.input("source");
  sync.following("translation", 0);
  expect(sync.canFollow("translation", 100)).toBe(false);
  expect(sync.canFollow("translation", 1000)).toBe(false);
  sync.input("translation");
  expect(sync.canFollow("translation", 1001)).toBe(true);
  sync.following("source", 1001);
  expect(sync.canFollow("source", 1100)).toBe(false);
});
