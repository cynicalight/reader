// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultTheme, type ReaderTheme } from "@reader/core";
import {
  resolveTheme,
  stepTranslationSize,
  translationFont,
  useResolvedTheme,
} from "./appearance";
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});
it("resolves explicit appearance independently from OS and preserves paper mode", () => {
  expect(
    resolveTheme({ ...defaultTheme, appearance: "light" }, true).mode,
  ).toBe("light");
  expect(
    resolveTheme({ ...defaultTheme, appearance: "dark" }, false).mode,
  ).toBe("dark");
  expect(
    resolveTheme({ ...defaultTheme, appearance: "light", mode: "sepia" }, true)
      .mode,
  ).toBe("sepia");
  expect(
    resolveTheme({ ...defaultTheme, appearance: "sepia" }, true).mode,
  ).toBe("sepia");
});
it("steps translated text size within bounds", () => {
  expect(defaultTheme.translationFontSize).toBeLessThan(defaultTheme.fontSize);
  expect(stepTranslationSize(1, 1)).toBe(1.05);
  expect(stepTranslationSize(0.8, -1)).toBe(0.8);
  expect(stepTranslationSize(1.6, 1)).toBe(1.6);
});
it("follows live system changes and unsubscribes on unmount", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let matches = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  const host = document.createElement("div");
  root = createRoot(host);
  function Theme({ theme }: { theme: ReaderTheme }) {
    return <span>{useResolvedTheme(theme).mode}</span>;
  }
  act(() => root!.render(<Theme theme={defaultTheme} />));
  expect(host.textContent).toBe("light");
  act(() => {
    matches = true;
    listeners.forEach((cb) => cb());
  });
  expect(host.textContent).toBe("dark");
  act(() =>
    root!.render(<Theme theme={{ ...defaultTheme, appearance: "light" }} />),
  );
  expect(host.textContent).toBe("light");
  act(() => root!.unmount());
  root = undefined;
  expect(listeners.size).toBe(0);
});

it("builds translated text fonts, falling back for installed ones", () => {
  expect(translationFont()).toContain("Songti SC");
  expect(translationFont("sans-serif")).toBe("inherit");
  expect(translationFont("serif")).toContain("Songti SC");
  expect(translationFont('LXGW "WenKai"')).toBe(
    '"LXGW WenKai", system-ui, sans-serif',
  );
});
