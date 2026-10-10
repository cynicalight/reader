// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { detectPage } from "./detect";
afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("reads Highwire metadata and arXiv PDF on a paper page", () => {
  vi.stubGlobal("location", {
    href: "https://arxiv.org/abs/2501.01234",
    hostname: "arxiv.org",
    pathname: "/abs/2501.01234",
  });
  document.head.innerHTML =
    '<meta name="citation_title" content="Example Paper"><meta name="citation_author" content="Ada Lovelace"><meta name="citation_doi" content="10.1000/example">';
  document.body.innerHTML = "<article><h1>Example Paper</h1></article>";
  const result = detectPage();
  expect(result.kind).toBe("single");
  expect(result.items[0].pdfUrl).toBe("https://arxiv.org/pdf/2501.01234");
  expect(result.items[0].metadata).toMatchObject({
    title: "Example Paper",
    doi: "10.1000/example",
    creators: [{ name: "Ada Lovelace" }],
  });
  expect(result.items[0].snapshot).toContain("<article>");
});
it("offers multiple Scholar results without treating the results page as one paper", () => {
  vi.stubGlobal("location", {
    href: "https://scholar.google.com/scholar?q=test",
    hostname: "scholar.google.com",
    pathname: "/scholar",
  });
  document.body.innerHTML =
    '<div class="gs_r gs_or"><h3><a href="https://example.org/one">Paper One</a></h3><a href="https://example.org/one.pdf">PDF</a></div><div class="gs_r gs_or"><h3><a href="https://example.org/two">Paper Two</a></h3></div>';
  const result = detectPage();
  expect(result.kind).toBe("list");
  expect(result.items).toHaveLength(2);
  expect(result.items[0].pdfUrl).toBe("https://example.org/one.pdf");
  expect(result.items[1].sourceUrl).toBe("https://example.org/two");
});
it("reads arXiv search results with separate title and identifier links", () => {
  vi.stubGlobal("location", {
    href: "https://arxiv.org/search/?query=security",
    hostname: "arxiv.org",
    pathname: "/search/",
  });
  document.body.innerHTML =
    '<li class="arxiv-result"><p class="list-title"><a href="https://arxiv.org/abs/2501.01234">arXiv:2501.01234</a></p><p class="title">Security Paper</p><a href="https://arxiv.org/pdf/2501.01234">pdf</a></li>';
  const result = detectPage();
  expect(result.kind).toBe("list");
  expect(result.items[0]).toMatchObject({
    title: "Security Paper",
    sourceUrl: "https://arxiv.org/abs/2501.01234",
    pdfUrl: "https://arxiv.org/pdf/2501.01234",
  });
});
