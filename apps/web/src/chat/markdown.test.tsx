import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { MessageMarkdown, safeMarkdownURL } from "./MessageMarkdown";
import { markdownFixture, splitFixture, type SplitMode } from "./fixtures";
import { nearBottom } from "./useChatScroll";
function render(content: string, generating = false) {
  return renderToStaticMarkup(
    <MessageMarkdown
      content={content}
      generating={generating}
      animated={false}
    />,
  );
}
describe("Markdown received source vs display", () => {
  it("renders external links as navigable anchors with an icon-only copy action", () => {
    const dom = new JSDOM(render("[项目](https://example.com)"));
    const link = dom.window.document.querySelector<HTMLAnchorElement>("a");
    expect(link?.href).toBe("https://example.com/");
    expect(link?.target).toBe("_blank");
    const copy = dom.window.document.querySelector(
      '[aria-label="复制链接 https://example.com"]',
    );
    expect(copy?.textContent).toBe("");
    expect(copy?.querySelector("svg")).not.toBeNull();
    dom.window.close();
  });
  it.each(["character", "word", "random", "whole"] as SplitMode[])(
    "final content is identical for %s fragments",
    (mode) => {
      const pieces = splitFixture(markdownFixture, mode);
      const result = pieces.join("");
      expect(result).toBe(markdownFixture);
      expect(render(result)).toBe(render(markdownFixture));
      // Deliberately incomplete delimiters exercise the live repair path.
      for (const cut of [3, 49, 99, 512, 800])
        expect(() => render(result.slice(0, cut), true)).not.toThrow();
    },
  );
  it("resolves cross-block definitions, omits active HTML and never fetches model images", () => {
    const dom = new JSDOM(render(markdownFixture));
    expect(dom.window.document.querySelector("script,img,iframe")).toBeNull();
    expect(
      dom.window.document.querySelector(
        '[aria-label="复制链接 https://example.com"]',
      ),
    ).not.toBeNull();
    expect(
      dom.window.document.querySelector("[data-footnotes]"),
    ).not.toBeNull();
    dom.window.close();
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "//evil.com",
    "/api/private",
  ])("rejects unsafe URL %s", (url) => expect(safeMarkdownURL(url)).toBe(""));
  it("uses the sidebar bottom threshold", () => {
    expect(nearBottom(70, 200, 100)).toBe(false);
    expect(nearBottom(80, 200, 100)).toBe(true);
  });
});
