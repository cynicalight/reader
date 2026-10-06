// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PDFBlock, TranslationBlock } from "@reader/core";
import { TranslationText } from "./TranslationText";
let host: HTMLDivElement, root: Root;
const base: PDFBlock = {
  id: "p1-b1",
  page: 1,
  label: "table",
  text: "INTERNAL CELLS 66.7 58.6",
  image: "assets/p1-b1.png",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  await import("../chat/MessageMarkdown");
  await import("./FormulaFragment");
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function render(
  block: PDFBlock,
  translation?: TranslationBlock,
  formulaNumber?: string,
) {
  await act(async () =>
    root.render(
      <TranslationText
        block={block}
        formulaNumber={formulaNumber}
        translation={translation}
        documentId="doc"
        retry={() => {}}
      />,
    ),
  );
  for (
    let i = 0;
    i < 80 &&
    host.querySelector(".translation-formula") == null &&
    block.formulaMarkdown;
    i++
  ) {
    if (
      host.querySelector("img") &&
      block.formulaMarkdown.includes("\\unknown")
    )
      break;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
}
it.each(["table", "chart", "image"])(
  "keeps %s body out of the translation view",
  async (label) => {
    await render({ ...base, label });
    expect(host.querySelector("img")).not.toBeNull();
    expect(host.textContent).not.toContain("INTERNAL");
    expect(host.textContent).not.toContain("正在翻译");
  },
);
it("renders only the translated caption alongside the table image", async () => {
  const caption = "Table 5. Results.";
  await render(
    { ...base, caption },
    {
      blockId: base.id,
      sourceHash: "test",
      status: "complete",
      sentences: [{ source: caption, target: "表 5. 结果。" }],
    },
  );
  expect(host.querySelector("img")).not.toBeNull();
  expect(host.textContent).toContain("表 5. 结果。");
  expect(host.textContent).not.toContain("INTERNAL");
});
it("inserts the formula-only Markdown at the formula block", async () => {
  await render({
    ...base,
    label: "display_formula",
    formulaMarkdown: "$$\nS(i,j)=\\frac{1}{2}\\log p_R(j\\mid i)\n$$\n",
  });
  for (let i = 0; i < 80 && !host.querySelector(".katex-display"); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
  expect(host.querySelector(".katex-display")).not.toBeNull();
  expect(host.querySelector(".katex-error")).toBeNull();
  expect(host.querySelector("details img")).not.toBeNull();
  expect(host.querySelector("details")?.open).toBe(false);
});
it("retains the original formula image for invalid LaTeX", async () => {
  await render({
    ...base,
    label: "display_formula",
    formulaMarkdown: "$$\n\\unknowncommand{x}\n$$\n",
  });
  expect(host.querySelector("img")).not.toBeNull();
  expect(host.querySelector(".katex-error")).toBeNull();
  expect(host.querySelector(".translation-formula")).toBeNull();
});

it.each(["$$\n x=1\n$$", "$$\n\\unknowncommand{x}\n$$", ""])(
  "keeps the equation number in the formula row: %s",
  async (formulaMarkdown) => {
    await render(
      { ...base, label: "display_formula", formulaMarkdown },
      undefined,
      "(6)",
    );
    const row = host.querySelector(".translation-formula-row");
    expect(row?.querySelector(".translation-formula-number")?.textContent).toBe(
      "(6)",
    );
    expect(row?.querySelector(".translation-formula-content")).not.toBeNull();
    expect(host.querySelectorAll(".translation-formula-number")).toHaveLength(
      1,
    );
    expect(
      host.querySelector("details .translation-formula-number"),
    ).toBeNull();
  },
);
