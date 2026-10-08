import { expect, it } from "vitest";
import { parseReaderLink, readerLink } from "./reader-link";

const id = "0123456789abcdef0123456789abcdef";
it("round-trips document, annotation and page targets", () => {
  for (const target of [
    { id },
    { id, annotation: "fedcba9876543210fedcba9876543210" },
    { id, page: 12 },
  ])
    expect(parseReaderLink(readerLink(target))).toEqual(target);
});
it("rejects other schemes, actions and malformed parameters", () => {
  for (const link of [
    `https://open?id=${id}`,
    `reader://delete?id=${id}`,
    "reader://open?id=../../etc",
    "not a link",
  ])
    expect(parseReaderLink(link)).toBeNull();
  expect(
    parseReaderLink(`reader://open?id=${id}&annotation=x&page=-1&extra=1`),
  ).toEqual({ id });
});
