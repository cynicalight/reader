// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AIConfig, AgentModel } from "@reader/core";
import { api } from "@reader/api";
import { toast } from "sonner";
import { Settings } from "./Settings";
import { useReaderStore } from "./store";

vi.mock("@reader/api", () => ({
  api: {
    providers: vi.fn(),
    aiConfig: vi.fn(),
    saveAIConfig: vi.fn(),
    testAI: vi.fn(),
    agentModels: vi.fn(async () => []),
    saveLibraryPreferences: vi.fn(async (value) => value),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
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
// Listed by the endpoint; the value says whether the model passes vision.
let listed: Record<string, boolean>;
const input = (label: string) =>
  host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const type = async (label: string, value: string) => {
  const element = input(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async () =>
  act(async () =>
    input("API 地址").form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
const openAPI = async () =>
  act(async () =>
    (
      host.querySelector('[aria-label="配置 API Key"]') as HTMLButtonElement
    ).click(),
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  config = {
    primary: "api",
    models: {},
    capabilities: {},
    api: { url: "", model: "", hasKey: false },
    textAPI: { url: "", model: "", hasKey: false },
    imageAPI: { url: "", model: "", hasKey: false },
  };
  useReaderStore.setState({ aiConfig: undefined, aiModelSaving: false });
  vi.mocked(api.providers).mockImplementation(async () => [
    {
      id: "api",
      installed: !!config.api.url,
      authenticated: config.api.hasKey,
      status: config.api.url ? "已配置" : "未配置",
    },
  ]);
  vi.mocked(api.aiConfig).mockImplementation(async () => config);
  listed = { "deepseek-flash": true, "deepseek-v4-pro": false };
  vi.mocked(api.saveAIConfig).mockImplementation(async (next) => {
    const { key, ...rest } = next.api;
    const changed = next.api.url !== config.api.url || !!key;
    config = {
      ...next,
      api: { ...rest, hasKey: !!key || next.api.hasKey },
      capabilities: changed ? {} : next.capabilities,
    };
    return config;
  });
  vi.mocked(api.agentModels).mockImplementation(async () =>
    [...Object.keys(listed), ...(config.apiModels ?? [])].map(
      (id): AgentModel => ({
        id,
        name: id,
        description: "",
        isDefault: false,
        custom: !(id in listed),
        capability: config.capabilities[`api:${id}`],
      }),
    ),
  );
  vi.mocked(api.testAI).mockImplementation(async (_provider, stage, model) => {
    const capability = {
      text: true,
      vision: stage === "vision" && !!listed[model!],
      checkedAt: "2026-10-09",
      pendingVision: stage === "text",
    };
    config = {
      ...config,
      capabilities: { ...config.capabilities, [`api:${model}`]: capability },
    };
    return capability;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("saves the API endpoint and key, then tests the new connection", async () => {
  await act(async () => root.render(<Settings open onOpenChange={() => {}} />));
  expect(host.textContent).toContain("未配置");
  expect(host.textContent).toContain("点击卡片配置你的apikey");
  expect(input("API 地址")).toBeNull();
  expect(api.testAI).not.toHaveBeenCalled();
  await openAPI();
  await type("API 地址", "https://api.deepseek.com");
  await type("API Key", "sk-test");
  await submit();
  expect(api.saveAIConfig).toHaveBeenLastCalledWith(
    expect.objectContaining({
      api: {
        url: "https://api.deepseek.com",
        model: "",
        key: "sk-test",
        hasKey: false,
      },
    }),
  );
  // Each listed model is checked on its own, text first, then vision.
  for (const model of ["deepseek-flash", "deepseek-v4-pro"])
    for (const stage of ["text", "vision"])
      expect(api.testAI).toHaveBeenCalledWith("api", stage, model);
  expect(
    host.querySelectorAll('.api-model-list [aria-label="图片理解：已通过"]'),
  ).toHaveLength(1);
  expect(toast.warning).not.toHaveBeenCalled();
  expect(input("API Key").value).toBe("");
  expect(input("API Key").placeholder).toBe("已保存，留空保持不变");
  await act(async () =>
    (
      host.querySelector('[aria-label="返回 Agent 设置"]') as HTMLButtonElement
    ).click(),
  );
  expect(input("API 地址")).toBeNull();
  expect(host.textContent).not.toContain("点击卡片查看 API 配置");
  const card = host.querySelector('[aria-label="配置 API Key"]')!;
  expect(card.querySelector('[aria-label="文本推理：已通过"]')).not.toBeNull();
  expect(card.querySelector('[aria-label="图片理解：已通过"]')).not.toBeNull();
  await openAPI();
  // Editing only the address keeps the saved key without resending it.
  await type("API 地址", "https://api.deepseek.com/v1");
  await submit();
  expect(api.saveAIConfig).toHaveBeenLastCalledWith(
    expect.objectContaining({
      api: {
        url: "https://api.deepseek.com/v1",
        model: "",
        key: undefined,
        hasKey: true,
      },
    }),
  );
  expect(api.testAI).toHaveBeenCalledTimes(8);
});
it("warns when no listed model passes the vision check", async () => {
  config.api = { url: "https://api.example.com", model: "", hasKey: true };
  listed = { "text-only": false };
  await act(async () => root.render(<Settings open onOpenChange={() => {}} />));
  await openAPI();
  expect(api.testAI).toHaveBeenCalledWith("api", "vision", "text-only");
  expect(toast.warning).toHaveBeenCalledOnce();
  await act(async () =>
    (
      host.querySelector('[aria-label="返回 Agent 设置"]') as HTMLButtonElement
    ).click(),
  );
  const card = host.querySelector('[aria-label="配置 API Key"]')!;
  expect(card.querySelector('[aria-label="文本推理：已通过"]')).not.toBeNull();
  expect(card.querySelector('[aria-label="图片理解：未通过"]')).not.toBeNull();
});
it("adds and removes a model ID by hand and checks it", async () => {
  config.api = { url: "https://api.example.com", model: "", hasKey: true };
  config.capabilities = {
    "api:deepseek-flash": { text: true, vision: true, checkedAt: "saved" },
    "api:deepseek-v4-pro": { text: true, vision: false, checkedAt: "saved" },
  };
  await act(async () => root.render(<Settings open onOpenChange={() => {}} />));
  await openAPI();
  expect(api.testAI).not.toHaveBeenCalled();
  await type("添加模型 ID", "my-model");
  await act(async () =>
    input("添加模型 ID").form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(config.apiModels).toEqual(["my-model"]);
  expect(api.testAI).toHaveBeenCalledWith("api", "text", "my-model");
  expect(api.testAI).toHaveBeenCalledTimes(2);
  await act(async () =>
    (
      host.querySelector('[aria-label="移除 my-model"]') as HTMLButtonElement
    ).click(),
  );
  expect(config.apiModels).toEqual([]);
  expect(host.textContent).not.toContain("my-model");
});
