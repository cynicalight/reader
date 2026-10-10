// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import {
  cursorAt,
  paint,
  Painter,
  readPalette,
  script,
  stillTime,
} from "./canvas";
import { scenes } from "./scenes";
import { guideTopics, onboardingPages } from "./topics";
import { guideLaunch, releaseNotes } from "./releases";
import { GuideHost } from "./GuideHost";

vi.mock("@reader/api", () => ({
  api: { guidePreferences: vi.fn(), saveGuidePreferences: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.setConfig({ testTimeout: 20_000 });

/** A 2D context that accepts every call and measures 6px per character. */
function recordingContext() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "measureText")
        return (text: string) => ({ width: text.length * 6 });
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        if (args.some((a) => typeof a === "number" && !Number.isFinite(a)))
          throw new Error(`${key} received a non-finite number`);
        calls.push(key);
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("guide launch", () => {
  const version = Object.keys(releaseNotes)[0];
  it("onboards a new library", () => {
    expect(guideLaunch({}, version, false)).toEqual({ kind: "onboarding" });
  });
  it("shows release notes instead to libraries from before the guide", () => {
    expect(guideLaunch({}, version, true)).toMatchObject({ kind: "release" });
  });
  it("shows release notes once per version", () => {
    const seen = { onboarded: true, seenVersion: version };
    expect(guideLaunch(seen, version, true)).toEqual({ kind: "none" });
    expect(
      guideLaunch({ onboarded: true, seenVersion: "0.0.1" }, version, true),
    ).toMatchObject({ kind: "release" });
  });
  it("records versions without notes silently", () => {
    expect(
      guideLaunch({ onboarded: true, seenVersion: "0.0.1" }, "0.0.2", true),
    ).toEqual({
      kind: "none",
      save: { onboarded: true, seenVersion: "0.0.2" },
    });
  });
  it("does not repeat the onboarding after the library is emptied", () => {
    expect(
      guideLaunch({ onboarded: true, seenVersion: "0.0.2" }, "0.0.2", false),
    ).toEqual({ kind: "none" });
  });
});

describe("guide content", () => {
  it("walks through agent, models, import and reading in order", () => {
    const pages = onboardingPages();
    expect([...new Set(pages.map((p) => p.topic.id))]).toEqual([
      "agent",
      "models",
      "import",
      "reading",
    ]);
    expect(pages.map((p) => p.step.scene)).toEqual([
      "detect",
      "login",
      "api",
      "models",
      "link",
      "pdf",
      "modes",
      "assistant",
    ]);
  });
  it("uses unique ids and existing scenes", () => {
    const steps = guideTopics.flatMap((t) => t.steps);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(new Set(guideTopics.map((t) => t.id)).size).toBe(guideTopics.length);
    for (const step of steps) expect(scenes[step.scene]).toBeDefined();
    for (const items of Object.values(releaseNotes))
      for (const item of items)
        if (item.topic)
          expect(guideTopics.some((t) => t.id === item.topic)).toBe(true);
  });
});

describe("guide canvas", () => {
  it("eases the pointer between scripted positions", () => {
    const s = script({ x: 0, y: 0 })
      .wait(100)
      .move({ x: 100, y: 50 }, 200)
      .build(500);
    expect(cursorAt(s, 50)).toEqual({ x: 0, y: 0 });
    expect(cursorAt(s, 200)).toEqual({ x: 50, y: 25 });
    expect(cursorAt(s, 300)).toEqual({ x: 100, y: 50 });
    expect(cursorAt(s, 799)).toEqual({ x: 100, y: 50 });
    expect(s.duration).toBe(800);
  });
  it.each(Object.entries(scenes))(
    "paints %s through its whole loop",
    (_, scene) => {
      const { ctx, calls } = recordingContext();
      const painter = new Painter(ctx, readPalette(), "sans-serif");
      for (let t = 0; t < scene.script.duration; t += 50)
        paint(scene, painter, t);
      paint(scene, painter, stillTime(scene), false);
      expect(stillTime(scene)).toBeLessThan(scene.script.duration);
      expect(calls.length).toBeGreaterThan(100);
    },
  );
});

describe("guide host", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => recordingContext().ctx as never,
    );
    vi.mocked(api.saveGuidePreferences).mockImplementation(async (v) => v);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const render = async (hasDocuments: boolean, version = "9.9.9") => {
    await act(async () =>
      root.render(
        <GuideHost
          ready
          version={version}
          hasDocuments={hasDocuments}
          open={false}
          onOpenChange={() => {}}
          onAction={() => {}}
        />,
      ),
    );
  };
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    )!;

  it("walks a new user through every onboarding step and remembers it", async () => {
    vi.mocked(api.guidePreferences).mockResolvedValue({});
    await render(false);
    expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
    const pages = onboardingPages();
    for (const page of pages.slice(0, -1)) {
      expect(document.body.textContent).toContain(page.step.title);
      await act(async () => button("下一步").click());
    }
    expect(document.body.textContent).toContain(pages.at(-1)!.step.title);
    await act(async () => button("开始使用").click());
    expect(api.saveGuidePreferences).toHaveBeenCalledWith({
      onboarded: true,
      seenVersion: "9.9.9",
    });
  });

  it("shows release notes to an existing library and records the version", async () => {
    const [version, items] = Object.entries(releaseNotes)[0];
    vi.mocked(api.guidePreferences).mockResolvedValue({});
    await render(true, version);
    expect(document.body.textContent).toContain(`Reader ${version} 更新内容`);
    expect(document.body.textContent).toContain(items[0].title);
    await act(async () => button("知道了").click());
    expect(api.saveGuidePreferences).toHaveBeenCalledWith({
      onboarded: true,
      seenVersion: version,
    });
  });

  it("shows nothing when the version was already seen", async () => {
    vi.mocked(api.guidePreferences).mockResolvedValue({
      onboarded: true,
      seenVersion: "9.9.9",
    });
    await render(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(api.saveGuidePreferences).not.toHaveBeenCalled();
  });
});
