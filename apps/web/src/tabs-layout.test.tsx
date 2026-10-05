import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@reader/ui/components/tabs";

// Build the real renderer stylesheet: checking component class strings alone
// cannot catch a mismatch between Tailwind variants and Base UI attributes.
let css = "";
const dom = new JSDOM();
beforeAll(async () => {
  const result = await build({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    plugins: [tailwindcss()],
    logLevel: "silent",
    build: {
      write: false,
      cssMinify: true,
      rollupOptions: {
        input: fileURLToPath(new URL("./style.css", import.meta.url)),
      },
    },
  });
  for (const bundle of Array.isArray(result) ? result : [result]) {
    if (!("output" in bundle)) continue;
    for (const asset of bundle.output) {
      if (asset.type === "asset" && asset.fileName.endsWith(".css")) {
        css += String(asset.source);
      }
    }
  }
}, 20_000);
afterAll(() => dom.window.close());

function renderTabs(orientation: "horizontal" | "vertical") {
  dom.window.document.body.innerHTML = renderToStaticMarkup(
    <Tabs defaultValue="toc" orientation={orientation}>
      <TabsList>
        <TabsTrigger value="toc">目录</TabsTrigger>
      </TabsList>
      <TabsContent value="toc">Introduction</TabsContent>
    </Tabs>,
  );
  return dom.window.document.querySelector('[data-slot="tabs"]')!;
}

describe("reader sidebar tab layout", () => {
  it("emits a column rule that matches the actual horizontal Tabs root", () => {
    const root = renderTabs("horizontal");
    const columnSelectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) =>
        /(?:^|;)flex-direction:\s*column(?:;|$)/.test(body!),
      )
      .map(([, selector]) => selector!.trim());
    expect(columnSelectors.length).toBeGreaterThan(0);
    expect(
      columnSelectors.some((selector) => {
        try {
          return root.matches(selector);
        } catch {
          return false;
        }
      }),
    ).toBe(true);
  });

  it("passes vertical orientation through to Base UI keyboard semantics", () => {
    renderTabs("vertical");
    expect(
      dom.window.document
        .querySelector('[role="tablist"]')
        ?.getAttribute("aria-orientation"),
    ).toBe("vertical");
  });
});

// Reflowable frames are direct children; fixed-layout frames sit in wrappers
// and receive their dimensions from Readium's fixed-layout manager.
it("sizes Readium reflowable frames to the reading area", async () => {
  const { realpathSync } = await import("node:fs");
  const { FrameManager } = await import(
    /* @vite-ignore */ realpathSync(
      "apps/web/node_modules/@readium/navigator",
    ) + "/dist/epub/frame/FrameManager.js"
  );
  const previousDocument = globalThis.document;
  Object.assign(globalThis, { document: dom.window.document });
  try {
    // jsdom does not implement iframe.sandbox's DOMTokenList yet.
    Object.defineProperty(dom.window.HTMLIFrameElement.prototype, "sandbox", {
      configurable: true,
      get() {
        const frame = this as HTMLIFrameElement;
        return {
          set value(value: string) {
            frame.setAttribute("sandbox", value);
          },
        };
      },
    });
    const manager = new FrameManager("about:blank");
    const host = dom.window.document.createElement("div");
    host.className = "reader-engine";
    host.append(manager.iframe);
    dom.window.document.body.replaceChildren(host);
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => {
        try {
          return manager.iframe.matches(selector!.trim());
        } catch {
          return false;
        }
      })
      .map(([, , declarations]) => declarations!)
      .join(";");
    expect(rules).toMatch(/(?:^|;)width:100%(?:;|$)/);
    expect(rules).toMatch(/(?:^|;)height:100%(?:;|$)/);
    const wrapper = dom.window.document.createElement("div");
    host.append(wrapper);
    wrapper.append(manager.iframe);
    expect(
      manager.iframe.matches(".reader-engine > .readium-navigator-iframe"),
    ).toBe(false);
  } finally {
    if (previousDocument) globalThis.document = previousDocument;
    else Reflect.deleteProperty(globalThis, "document");
  }
});
