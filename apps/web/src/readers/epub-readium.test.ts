// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { EpubNavigator } from "@readium/navigator";
import { Locator } from "@readium/shared";
import { selectionLocator } from "./selection-locator";

// Exercise the installed distribution used by Vite, not a mock of Readium.
const navigatorRoot = realpathSync("apps/web/node_modules/@readium/navigator");
const injectableRoot = realpathSync(
  join(dirname(navigatorRoot), "navigator-html-injectables"),
);
const { ModuleLibrary } = await import(
  /* @vite-ignore */ join(injectableRoot, "dist/index.js")
);
afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("[data-readium]").forEach((e) => e.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  "column_snapper",
  "scroll_snapper",
  "cjk_vertical_snapper",
  "webpub_snapper",
])(
  "keeps the exact second duplicate through the real %s navigation handler",
  async (name) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    document.body.innerHTML = `<p>${"same ".repeat(60)}</p>`;
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: document.documentElement,
    });
    const node = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 150);
    range.setEnd(node, 154);
    const locator = selectionLocator(
      Locator.deserialize({
        href: "chapter.xhtml",
        type: "application/xhtml+xml",
      })!,
      range,
    )!;
    const restored = Locator.deserialize(
      JSON.parse(JSON.stringify(locator.serialize())),
    )!;
    const navigated = vi.fn();
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Range) {
        navigated(this.startContainer, this.startOffset, this.endOffset);
        return new DOMRect(2200, 1600, 40, 20);
      },
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const commands = new Map<
      string,
      (data: unknown, ack: (ok: boolean) => void) => void
    >();
    const comms = {
      register: (
        key: string | string[],
        _name: string,
        handler: (data: unknown, ack: (ok: boolean) => void) => void,
      ) => {
        for (const item of Array.isArray(key) ? key : [key])
          commands.set(item, handler);
      },
      unregisterAll: vi.fn(),
      send: vi.fn(),
      log: vi.fn(),
    };
    const snapper = new (ModuleLibrary.get(name))();
    snapper.mount(window, comms);
    const navigator = Object.create(EpubNavigator.prototype);
    const send = vi.fn(
      (command: string, data: unknown, callback: (ok: boolean) => void) =>
        commands.get(command)!(data, callback),
    );
    Object.defineProperty(navigator, "_cframes", {
      value: [{ msg: { send } }],
    });
    const completed = vi.fn();
    await navigator.loadLocator(restored, completed);
    expect(completed).toHaveBeenCalledWith(true);
    expect(navigated).toHaveBeenCalledWith(node, 150, 154);
    expect(send).toHaveBeenCalledWith(
      "go_text",
      { locator: restored.serialize() },
      expect.any(Function),
    );
    snapper.unmount(window, comms);
  },
);
it("reports a failed exact navigation instead of silently going to progression", async () => {
  const navigator = Object.create(EpubNavigator.prototype);
  const send = vi.fn((_command, _data, callback) => callback(false));
  Object.defineProperty(navigator, "_cframes", { value: [{ msg: { send } }] });
  const locator = Locator.deserialize({
    href: "chapter.xhtml",
    type: "application/xhtml+xml",
    locations: { domRange: {}, progression: 0.8 },
    text: { highlight: "missing" },
  })!;
  const completed = vi.fn();
  await navigator.loadLocator(locator, completed);
  expect(completed).toHaveBeenCalledWith(false);
  expect(send).toHaveBeenCalledTimes(1);
});
