import { expect, it, vi } from "vitest";
import type { DocumentLocation } from "@reader/core";
import { destinationPoint, parseDestinationHash } from "./pdf-link-preview";
import { ReferenceNavigation } from "../reference-navigation";

it("parses PDF.js internal link hashes", () => {
  const explicit = [{ num: 12, gen: 0 }, { name: "XYZ" }, 72, 700, null];
  expect(parseDestinationHash("#" + escape(JSON.stringify(explicit)))).toEqual({
    dest: explicit,
  });
  expect(parseDestinationHash("#cite.vaswani2017")).toEqual({
    dest: "cite.vaswani2017",
  });
  expect(parseDestinationHash("#nameddest=fig%3A3")).toEqual({
    dest: "fig:3",
  });
  expect(parseDestinationHash("#page=4&zoom=auto")).toEqual({ page: 4 });
  expect(parseDestinationHash("#")).toEqual({});
});

it("reads the target point of each destination mode", () => {
  const ref = { num: 1, gen: 0 };
  expect(destinationPoint([ref, { name: "XYZ" }, 300, 500, 0])).toEqual({
    left: 300,
    top: 500,
  });
  expect(destinationPoint([ref, { name: "FitH" }, 640])).toEqual({
    left: null,
    top: 640,
  });
  expect(destinationPoint([ref, { name: "FitR" }, 10, 20, 30, 40])).toEqual({
    left: 10,
    top: 40,
  });
  expect(destinationPoint([ref, { name: "Fit" }])).toEqual({
    left: null,
    top: null,
  });
});

it("forgets return points that are back on screen", async () => {
  let near = false;
  const origin: DocumentLocation = { type: "pdf", page: 2, y: 0.3 };
  const reader = {
    getLocation: () => origin,
    goTo: vi.fn().mockResolvedValue(undefined),
    isNear: () => near,
  };
  const navigation = new ReferenceNavigation(reader);
  // A link click records the start; a far target keeps it.
  navigation.remember(origin);
  expect(navigation.settle()).toBe(false);
  expect(navigation.origin).toEqual(origin);
  // A second jump keeps the first start.
  navigation.remember({ type: "pdf", page: 9 });
  expect(navigation.origin).toEqual(origin);
  // Scrolling back near the start drops the return button.
  near = true;
  expect(navigation.settle()).toBe(true);
  expect(navigation.origin).toBeUndefined();
  // A visit to something already on screen leaves no return point.
  await navigation.visit({ type: "pdf", page: 2, y: 0.4 });
  expect(navigation.origin).toBeUndefined();
});

it("keeps the return point during location events before the link has moved the viewport", () => {
  let near = true;
  const origin: DocumentLocation = { type: "pdf", page: 2, y: 0.3 };
  const navigation = new ReferenceNavigation({
    getLocation: () => origin,
    goTo: vi.fn(),
    isNear: () => near,
  });
  navigation.remember(origin);
  expect(navigation.settle()).toBe(false);
  expect(navigation.origin).toEqual(origin);
  near = false;
  expect(navigation.settle()).toBe(false);
  near = true;
  expect(navigation.settle()).toBe(true);
});
