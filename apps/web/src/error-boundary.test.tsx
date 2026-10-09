// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

vi.mock("./reading-links", async (original) => ({
  ...(await original<typeof import("./reading-links")>()),
  remarkReadingCitations: () => () => {
    throw new Error("broken plugin");
  },
}));
import { MessageMarkdown } from "./chat/MessageMarkdown";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Paragraph({ text }: { text: string }) {
  if (text === "bad") throw new Error("render failed");
  return <p>{text}</p>;
}
const view = (text: string) => (
  <main>
    <span>sidebar</span>
    <ErrorBoundary resetKey={text} fallback={<p>此段无法显示</p>}>
      <Paragraph text={text} />
    </ErrorBoundary>
  </main>
);

it("keeps the rest of the page and retries when the reset key changes", async () => {
  await act(async () => root.render(view("bad")));
  expect(host.textContent).toBe("sidebar此段无法显示");
  await act(async () => root.render(view("fixed")));
  expect(host.textContent).toBe("sidebarfixed");
});

it("falls back to the raw text when Markdown rendering throws", async () => {
  await act(async () =>
    root.render(
      <MessageMarkdown content={"见 **[3]**"} citationBlockId="p1-b1" />,
    ),
  );
  expect(host.querySelector(".message-markdown")?.textContent).toBe(
    "见 **[3]**",
  );
});
