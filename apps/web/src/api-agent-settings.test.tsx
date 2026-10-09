// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AIConfig } from "@reader/core";
import { api } from "@reader/api";
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
  vi.mocked(api.saveAIConfig).mockImplementation(async (next) => {
    const { key, ...rest } = next.api;
    config = {
      ...next,
      api: { ...rest, hasKey: !!key || next.api.hasKey },
      capabilities: {},
    };
    return config;
  });
  vi.mocked(api.testAI).mockResolvedValue({
    text: true,
    vision: false,
    checkedAt: "2026-10-09",
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
  expect(api.testAI).not.toHaveBeenCalled();
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
  expect(api.testAI).toHaveBeenCalledWith("api", "text");
  expect(input("API Key").value).toBe("");
  expect(input("API Key").placeholder).toBe("已保存，留空保持不变");
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
  expect(api.testAI).toHaveBeenCalledTimes(4);
});
