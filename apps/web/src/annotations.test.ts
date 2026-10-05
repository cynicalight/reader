import { expect, it } from "vitest";
import type { Annotation } from "@reader/core";
import { activeAnnotation, applySavedAnnotation } from "./annotations";
const a: Annotation = {
  id: "a",
  documentId: "doc",
  kind: "underline",
  location: { type: "pdf", page: 1 },
  quote: "one two",
  note: "",
  color: "",
  createdAt: "",
};
it("replaces a merged underline in place and removes only superseded IDs", () => {
  const note = { ...a, id: "note", kind: "note" as const, note: "Keep this" };
  const result = applySavedAnnotation(
    [a, note, { ...a, id: "b", quote: "two three" }],
    { ...a, quote: "one two three", replacedIds: ["b"] },
  );
  expect(result.map((item) => item.id)).toEqual(["a", "note"]);
  expect(result[0].quote).toBe("one two three");
  expect(result[1]).toBe(note);
  expect(result[0]).not.toHaveProperty("replacedIds");
  expect(
    applySavedAnnotation(result, { ...a, quote: "one two three" }),
  ).toEqual(result);
});
it("edits an existing note when several annotation kinds cover a passage", () => {
  const note = { ...a, id: "note", kind: "note" as const, note: "Keep this" };
  expect(activeAnnotation([a, note], [a.id, note.id])).toBe(note);
  expect(activeAnnotation([a, note], [a.id])).toBe(a);
});
