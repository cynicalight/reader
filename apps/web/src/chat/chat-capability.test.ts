import { afterEach, expect, it, vi } from "vitest";
import { api, chat } from "@reader/api";
import type { AIConfig } from "@reader/core";
import { useReaderStore, refreshAIConfig } from "../store";
import { ChatSession } from "./chat-session";

vi.mock("@reader/api", () => ({
  api: { messages: vi.fn().mockResolvedValue([]), aiConfig: vi.fn() },
  chat: vi.fn(),
}));
const config: AIConfig = {
  primary: "codex",
  models: {},
  capabilities: {},
  textAPI: { url: "", model: "", hasKey: false },
  imageAPI: { url: "", model: "", hasKey: false },
};
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it.each([false, true])(
  "refreshes persisted capabilities after chat, including thrown failures: %s",
  async (fails) => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
      setTimeout(callback, 0),
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    useReaderStore.setState({ aiConfig: config });
    const failed = {
      ...config,
      capabilities: {
        codex: {
          text: false,
          vision: false,
          checkedAt: "2026-10-05",
          error: "Agent 调用失败",
        },
      },
    };
    vi.mocked(api.aiConfig).mockResolvedValue(failed);
    if (fails) vi.mocked(chat).mockRejectedValueOnce(new Error("failed"));
    else vi.mocked(chat).mockResolvedValueOnce(undefined);
    const session = new ChatSession("doc");
    await session.load();
    await session.send({
      provider: "codex",
      prompt: "test",
      context: "",
      references: [],
      attachments: [],
    });
    expect(useReaderStore.getState().aiConfig).toEqual(failed);
    session.dispose();
  },
);
it("does not overwrite a concurrent settings change with an older refresh", async () => {
  useReaderStore.setState({ aiConfig: config });
  let finish!: (value: AIConfig) => void;
  vi.mocked(api.aiConfig).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const request = refreshAIConfig();
  const newer = { ...config, primary: "claude" };
  useReaderStore.getState().setAIConfig(newer);
  finish(config);
  await request;
  expect(useReaderStore.getState().aiConfig).toBe(newer);
});
