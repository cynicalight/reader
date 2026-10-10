// @vitest-environment jsdom
import { expect, it } from "vitest";
import { searchRanges } from "./search-ranges";

it("marks repeated words precisely across text nodes", () => {
  const host = document.createElement("div");
  host.innerHTML = "<span>能</span><strong>力</strong><span>与能力</span>";
  const ranges = [...host.querySelectorAll("span, strong")].map((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild!);
    return range;
  });
  expect(searchRanges(ranges, "能力").map((range) => range.toString())).toEqual(
    ["能", "力", "能力"],
  );
});
