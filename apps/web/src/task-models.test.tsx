// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import type { AIConfig, AgentModel } from "@reader/core";
import { TaskModels, taskChoice } from "./TaskModels";
import { useReaderStore } from "./store";
vi.mock("@reader/api", () => ({
  api: { agentModels: vi.fn(), aiConfig: vi.fn(), saveAIConfig: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const models: AgentModel[] = [
  { id: "opus", name: "Opus", description: "", isDefault: true },
  {
    id: "fable",
    name: "Fable",
    description: "",
    isDefault: false,
    recommendedFor: ["chat"],
  },
  {
    id: "sonnet",
    name: "Sonnet",
    description: "",
    isDefault: false,
    recommendedFor: ["translation"],
  },
];
let root: Root;
let host: HTMLDivElement;
let config: AIConfig;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  config = {
    primary: "claude",
    models: { claude: "opus" },
    efforts: { claude: { opus: "high" } },
    capabilities: {},
    textAPI: { url: "", model: "", hasKey: false },
    imageAPI: { url: "", model: "", hasKey: false },
  };
  useReaderStore.setState({ aiConfig: config, aiModelSaving: false });
  vi.mocked(api.agentModels).mockResolvedValue(models);
  vi.mocked(api.aiConfig).mockImplementation(async () => config);
  vi.mocked(api.saveAIConfig).mockImplementation(async (value) => {
    config = value;
    return value;
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
const trigger = (label: string) =>
  host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
const shown = (label: string) =>
  trigger(label).querySelector("[data-slot=select-value]")?.textContent;
async function choose(label: string, text: string) {
  await act(async () => trigger(label).click());
  const option = Array.from(document.querySelectorAll('[role="option"]')).find(
    (item) => item.textContent === text,
  ) as HTMLElement;
  expect(option).toBeDefined();
  await act(async () => {
    option.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    option.click();
  });
}
it("defaults effort to medium and keys choices per task", () => {
  expect(taskChoice(config, "chat")).toEqual({ model: "opus", effort: "high" });
  expect(taskChoice(config, "translation")).toEqual({
    model: "",
    effort: "medium",
  });
});
// Opening a Base UI select takes about a second in jsdom; keep one per test.
it("shows recommended translation defaults", async () => {
  await act(async () => root.render(<TaskModels disabled={false} />));
  expect(shown("问答模型")).toBe("Opus");
  expect(shown("翻译模型")).toBe("自动 · Sonnet");
  expect(shown("翻译 Effort")).toBe("Medium");
});
it("saves the translation model without touching chat", async () => {
  await act(async () => root.render(<TaskModels disabled={false} />));
  await choose("翻译模型", "Fable");
  expect(config.translationModels).toEqual({ claude: "fable" });
  expect(config.models).toEqual({ claude: "opus" });
});
it("saves the translation effort without touching chat", async () => {
  config.translationModels = { claude: "fable" };
  useReaderStore.setState({ aiConfig: config });
  await act(async () => root.render(<TaskModels disabled={false} />));
  await choose("翻译 Effort", "Low");
  expect(config.translationEfforts).toEqual({ claude: { fable: "low" } });
  expect(config.efforts).toEqual({ claude: { opus: "high" } });
});
it("returns translation to automatic selection", async () => {
  config.translationModels = { claude: "fable" };
  useReaderStore.setState({ aiConfig: config });
  await act(async () => root.render(<TaskModels disabled={false} />));
  await choose("翻译模型", "自动 · Sonnet");
  expect(config.translationModels).toEqual({ claude: "" });
});
