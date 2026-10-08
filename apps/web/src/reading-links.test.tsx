// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageMarkdown } from "./chat/MessageMarkdown";
import { ReadingLinkNavigation } from "./reading-links";
import { installPDFExternalLinks } from "./readers/pdf-external-links";
vi.mock("./chat/clipboard", () => ({ copyText: vi.fn(async () => true) }));
const openExternal = vi.fn(async () => {});
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(window, "readerDesktop", {
    configurable: true,
    value: { openExternal },
  });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  host.remove();
  Object.defineProperty(window, "readerDesktop", {
    configurable: true,
    value: undefined,
  });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("opens translated links in the system browser, has no copy icons, and routes citations without touching inline code", async () => {
  const navigate = vi.fn();
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ReadingLinkNavigation.Provider value={navigate}>
          <MessageMarkdown
            content="见 [6, 7]。`[8]` [项目](https://example.com/。)"
            citationBlockId="p1-b1"
          />
        </ReadingLinkNavigation.Provider>,
      ),
    );
    const external = host.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/"]',
    )!;
    expect(external).toBeTruthy();
    external.click();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/",
    );
    expect(host.querySelector("button")).toBeNull();
    const citations = host.querySelectorAll<HTMLAnchorElement>(
      'a[href^="#reader-citation?"]',
    );
    expect(citations).toHaveLength(2);
    citations[0].click();
    expect(navigate).toHaveBeenCalledExactlyOnceWith("p1-b1", "6");
    expect(host.querySelector("code")?.textContent).toBe("[8]");
  } finally {
    await act(async () => root.unmount());
  }
});
it("preserves current PDF.js internal links and omits copy icons", async () => {
  host.innerHTML =
    '<div class="annotationLayer"><section><a href="https://example.com/">项目</a></section><section data-internal-link><a href="http://127.0.0.1/#cite.six">[6]</a></section></div>';
  let cleanup: (() => void) | undefined;
  try {
    await act(async () => {
      cleanup = installPDFExternalLinks(host);
    });
    host.querySelector<HTMLAnchorElement>("a")!.click();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/",
    );
    expect(host.querySelector("button")).toBeNull();
    const internal = host.querySelector<HTMLAnchorElement>(
      "[data-internal-link] a",
    )!;
    const nativeClick = vi.fn((event: MouseEvent) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    internal.addEventListener("click", nativeClick);
    internal.click();
    expect(nativeClick).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    await act(async () => host.querySelector("a")!.remove());
    expect(host.querySelector("button")).toBeNull();
  } finally {
    await act(async () => cleanup?.());
  }
});
