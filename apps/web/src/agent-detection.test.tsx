// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AICapability, AIConfig } from "@reader/core";
import { api } from "@reader/api";
import { Settings } from "./Settings";
import { useReaderStore } from "./store";

vi.mock("@reader/api", () => ({
  api: { providers: vi.fn(), aiConfig: vi.fn(), testAI: vi.fn() },
}));
vi.mock("@reader/ui/components/dialog", () => {
  const Content = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Content,
    DialogHeader: Content,
    DialogTitle: Content,
    DialogDescription: Content,
  };
});
let root: Root;
let host: HTMLDivElement;
let config: AIConfig;
let complete: (capability: AICapability) => void;
const passed = { text: true, vision: true, checkedAt: "2026-10-05" };
const render = async (open = true) => {
  await act(async () =>
    root.render(<Settings open={open} onOpenChange={() => {}} />),
  );
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  config = {
    primary: "codex",
    models: {},
    capabilities: {},
    textAPI: { url: "", model: "", hasKey: false },
    imageAPI: { url: "", model: "", hasKey: false },
  };
  useReaderStore.setState({ aiConfig: undefined, aiModelSaving: false });
  vi.mocked(api.providers).mockResolvedValue([
    { id: "codex", installed: true, authenticated: true, status: "已登录" },
    { id: "claude", installed: false, authenticated: false, status: "未安装" },
  ]);
  vi.mocked(api.aiConfig).mockImplementation(async () => config);
  vi.mocked(api.testAI).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = (capability) => {
          config = { ...config, capabilities: { codex: capability } };
          resolve(capability);
        };
      }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("automatically checks installed agents once, even when settings reopen during a check", async () => {
  await render();
  expect(api.testAI).toHaveBeenCalledExactlyOnceWith("codex");
  expect(host.querySelector('[aria-label="文本推理：检测中"]')).not.toBeNull();
  expect(host.textContent).not.toContain("测试可用性与识图");
  expect(host.querySelector('[aria-label="图片理解：检测中"]')).not.toBeNull();
  await render(false);
  await render();
  expect(api.testAI).toHaveBeenCalledTimes(1);
  await act(async () => complete(passed));
  expect(host.querySelector('[data-state="passed"]')).not.toBeNull();
  await render(false);
  await render();
  expect(api.testAI).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-state="passed"]')).not.toBeNull();
});
it("shows independent text and image results and allows an explicit retry", async () => {
  await render();
  await act(async () =>
    complete({ ...passed, vision: false, error: "图片能力未通过检测" }),
  );
  expect(
    host.querySelector('[aria-label="文本推理：已通过"] [data-state="passed"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('[aria-label="图片理解：未通过"] [data-state="failed"]'),
  ).not.toBeNull();
  await act(async () =>
    (
      host.querySelector('[aria-label="重新检测 Agent"]') as HTMLButtonElement
    ).click(),
  );
  expect(api.testAI).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-state="pending"]')).not.toBeNull();
  await act(async () => complete(passed));
  expect(host.querySelector('[data-state="passed"]')).not.toBeNull();
});
it.each([passed, { ...passed, vision: false, error: "识图失败" }])(
  "reuses persisted results after settings remount until an explicit retry",
  async (capability) => {
    config = { ...config, capabilities: { codex: capability } };
    await render();
    expect(api.testAI).not.toHaveBeenCalled();
    expect(
      host.querySelector('[aria-label="文本推理：已通过"]'),
    ).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(api.testAI).not.toHaveBeenCalled();
    await act(async () =>
      (
        host.querySelector('[aria-label="重新检测 Agent"]') as HTMLButtonElement
      ).click(),
    );
    expect(api.testAI).toHaveBeenCalledExactlyOnceWith("codex");
    await act(async () => complete(passed));
    expect(useReaderStore.getState().aiConfig?.capabilities.codex).toEqual(
      passed,
    );
  },
);
it("keeps a saved check visible while metadata loads and reflects global failures", async () => {
  config = { ...config, capabilities: { codex: passed } };
  useReaderStore.setState({ aiConfig: config });
  let finish!: (value: AIConfig) => void;
  vi.mocked(api.aiConfig).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  expect(host.querySelector('[aria-label="文本推理：已通过"]')).not.toBeNull();
  await act(async () => finish(config));
  await act(async () =>
    useReaderStore
      .getState()
      .setAIConfig({
        ...config,
        capabilities: {
          codex: { ...passed, text: false, vision: false, error: "调用失败" },
        },
      }),
  );
  expect(host.querySelector('[aria-label="文本推理：未通过"]')).not.toBeNull();
  expect(api.testAI).not.toHaveBeenCalled();
});
