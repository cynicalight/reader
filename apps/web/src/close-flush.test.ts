// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("./progress", () => ({
  flushProgress: vi.fn(async () => void calls.push("progress")),
}));
vi.mock("@reader/api", () => ({
  api: {
    saveSettings: vi.fn(async () => void calls.push("settings")),
  },
}));
vi.mock("./store", () => ({
  useReaderStore: { getState: () => ({ theme: { mode: "light" } }) },
}));
import { installCloseFlush } from "./close-flush";

afterEach(() => {
  calls.length = 0;
  Object.defineProperty(window, "readerDesktop", {
    configurable: true,
    value: undefined,
  });
});

it("answers the desktop close request without any React tree", async () => {
  let close: (() => Promise<void>) | undefined;
  const remove = vi.fn();
  Object.defineProperty(window, "readerDesktop", {
    configurable: true,
    value: {
      onBeforeClose: (callback: () => Promise<void>) => {
        close = callback;
        return remove;
      },
    },
  });
  const uninstall = installCloseFlush();
  await close!();
  expect(calls).toEqual(["progress", "settings"]);
  window.dispatchEvent(new Event("pagehide"));
  expect(calls).toEqual(["progress", "settings", "progress"]);
  uninstall();
  expect(remove).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("pagehide"));
  expect(calls).toHaveLength(3);
});
