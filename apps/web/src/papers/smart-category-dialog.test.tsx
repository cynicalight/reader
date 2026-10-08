// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SmartCategoryDialog } from "./SmartCategoryDialog";

let root: Root, host: HTMLDivElement;
const onSave = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SmartCategoryDialog
        smart={{ id: "s", name: "", tags: [] }}
        tags={["LLM", "RL"]}
        isNew
        onSave={onSave}
        onClose={() => {}}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

it("saves a name with the chosen and typed tags", async () => {
  const dialog = document.querySelector('[role="dialog"]')!;
  const create = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "创建",
  )!;
  expect(create.disabled).toBe(true);
  await act(async () =>
    setValue(dialog.querySelector('input[aria-label="分类名"]')!, "RLHF"),
  );
  const rl = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "#RL",
  )!;
  await act(async () => rl.click());
  const extra = dialog.querySelector<HTMLInputElement>(
    'input[aria-label="添加标签"]',
  )!;
  await act(async () => setValue(extra, "#Reward"));
  await act(async () =>
    extra.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  await act(async () => create.click());
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    id: "s",
    name: "RLHF",
    tags: ["RL", "Reward"],
  });
});
