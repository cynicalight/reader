// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LargePaperDialog } from "./LargePaperDialog";

it("offers to keep a long PDF as a paper or import it as a book", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onChoose = vi.fn();
  await act(async () =>
    root.render(
      <LargePaperDialog
        papers={[{ name: "thesis.pdf", pages: 88 }]}
        busy={false}
        onChoose={onChoose}
        onCancel={() => {}}
      />,
    ),
  );
  expect(document.body.textContent).toContain("检测到 PDF 过大");
  expect(document.body.textContent).toContain("“thesis.pdf”有 88 页");
  const buttons = Array.from(document.body.querySelectorAll("button"));
  await act(async () =>
    buttons.find((b) => b.textContent === "仍然导入为论文")!.click(),
  );
  await act(async () =>
    buttons.find((b) => b.textContent === "导入到图书库")!.click(),
  );
  expect(onChoose.mock.calls).toEqual([["papers"], ["books"]]);
  await act(async () => root.unmount());
  host.remove();
});
