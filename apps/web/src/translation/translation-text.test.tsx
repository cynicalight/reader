// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationText } from "./TranslationText";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each([
  "Algorithm 1: Read phase\n1     Function read(txn, record)\n2         latch(record)",
  "Algorithm 2: use ``` and `x` inside",
])("renders algorithm text as a code block: %s", async (text) => {
  await act(async () =>
    root.render(
      <TranslationText
        block={{ id: "p7-b9", label: "algorithm", text }}
        documentId="doc"
        retry={() => {}}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(host.querySelector(".translation-algorithm pre code")).toBeTruthy(),
  );
  expect(
    host.querySelector(".translation-algorithm pre code")?.textContent,
  ).toBe(`${text}\n`);
});
