// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import type { Document, Processing } from "@reader/core";
import { useReaderStore } from "../store";
import { PaperLibrary } from "./PaperLibrary";
import { PaperSidebar } from "./PaperSidebar";
import { usePaperUI } from "./state";
import { paper } from "./fixtures";
vi.mock("@reader/api", () => ({
  api: {
    update: vi.fn(async () => ({})),
    documents: vi.fn(async () => []),
    trash: vi.fn(async () => []),
    trashDocument: vi.fn(),
    restoreDocument: vi.fn(),
    saveLibraryPreferences: vi.fn(async (value) => value),
    changeLibraryTag: vi.fn(async () => ({ changed: 1 })),
    changeLibraryFolder: vi.fn(async () => ({ changed: 1 })),
    mergeDocuments: vi.fn(async () => ({ trashed: [] })),
    relateDocuments: vi.fn(async () => ({})),
    unrelateDocuments: vi.fn(async () => ({})),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const docs: Document[] = [
  paper({
    id: "a",
    title: "Attention Is All You Need",
    folders: ["ML"],
    metadata: {
      creators: [{ given: "Ashish", family: "Vaswani" }],
      date: "2017",
      venue: "NeurIPS",
      abstract: "The dominant sequence transduction models…",
    },
  }),
  paper({ id: "b", title: "Graph Attention Networks", readingStatus: "done" }),
];
let root: Root, host: HTMLDivElement;
const open = vi.fn();
let jobs = new Map<string, Processing>();
function Harness() {
  const documents = useReaderStore((s) => s.documents);
  return (
    <>
      <PaperSidebar
        documents={documents}
        jobs={jobs}
        trashCount={0}
        openDocument={open}
        onNewCategory={() => {}}
      />
      <PaperLibrary
        documents={documents}
        trash={[]}
        jobs={jobs}
        loading={false}
        openDocument={open}
        moveToBooks={() => {}}
        navOpen
        onToggleNav={() => {}}
      />
    </>
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  jobs = new Map();
  vi.mocked(api.documents).mockImplementation(
    async () => useReaderStore.getState().documents,
  );
  useReaderStore.setState({
    documents: docs,
    libraryPreferences: { mode: "papers", papers: { sort: "title" } },
  });
  usePaperUI.setState({
    view: "all",
    query: "",
    selectedId: null,
    picking: false,
    picked: new Set(),
    anchor: null,
    naming: null,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const row = (title: string) =>
  host.querySelector<HTMLElement>(`[aria-label="${title}"][data-paper-id]`)!;
const navButton = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".paper-nav-item")].find((b) =>
    b.textContent?.includes(label),
  )!;

it("lists papers with author, year and venue and opens on double click", async () => {
  expect(row("Attention Is All You Need").textContent).toContain(
    "Ashish Vaswani · 2017 · NeurIPS",
  );
  await act(async () =>
    row("Graph Attention Networks").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    ),
  );
  expect(open).toHaveBeenCalledExactlyOnceWith(docs[1]);
});

it("shows details on click and saves an edited field as manual metadata", async () => {
  await act(async () => row("Attention Is All You Need").click());
  const detail = host.querySelector(".paper-detail")!;
  expect(detail.textContent).toContain("摘要");
  const venue = detail.querySelector<HTMLInputElement>('[aria-label="出处"]')!;
  expect(venue.value).toBe("NeurIPS");
  venue.value = "NIPS 2017";
  await act(async () => {
    venue.focus();
    venue.blur();
  });
  expect(api.update).toHaveBeenCalledExactlyOnceWith("a", {
    metadata: { venue: "NIPS 2017" },
  });
});

it("filters by sidebar views and the search box", async () => {
  await act(async () => navButton("已读").click());
  expect(host.querySelectorAll("[data-paper-id]")).toHaveLength(1);
  expect(row("Graph Attention Networks")).toBeTruthy();
  await act(async () => navButton("ML").click());
  expect(host.querySelector(".library-title")?.textContent).toBe("ML");
  expect(host.querySelectorAll("[data-paper-id]")).toHaveLength(1);
  await act(async () => navButton("全部论文").click());
  const search = host.querySelector<HTMLInputElement>(
    '[aria-label="搜索论文"]',
  )!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(search, "vaswani 2017");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll("[data-paper-id]")).toHaveLength(1);
});

it("selects all visible papers and changes their status together", async () => {
  await act(async () =>
    row("Attention Is All You Need").dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true }),
    ),
  );
  expect(host.textContent).toContain("已选 2 篇");
  await act(async () => row("Attention Is All You Need").click());
  expect(host.textContent).toContain("已选 1 篇");
  const star = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "星标",
  )!;
  await act(async () => star.click());
  expect(api.update).toHaveBeenCalledExactlyOnceWith("b", { favorite: true });
});

it("renames a category everywhere through the library endpoint", async () => {
  await act(async () =>
    navButton("ML").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
  const rename = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "改名")!;
  await act(async () => rename.click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="分类名"]')!;
  input.value = "Machine learning";
  await act(async () =>
    input.form!.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(api.changeLibraryFolder).toHaveBeenCalledExactlyOnceWith(
    "papers",
    "ML",
    "Machine learning",
  );
});

it("shows subcategories under their parent and renames only the leaf", async () => {
  await act(async () =>
    useReaderStore.setState({
      documents: [{ ...docs[0], folders: ["ML/Vision"] }, docs[1]],
    }),
  );
  expect(navButton("ML").textContent).toContain("1");
  await act(async () => navButton("ML").click());
  expect(host.querySelectorAll("[data-paper-id]")).toHaveLength(1);
  await act(async () =>
    navButton("Vision").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
  const rename = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "改名")!;
  await act(async () => rename.click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="分类名"]')!;
  expect(input.value).toBe("Vision");
  input.value = "CV";
  await act(async () =>
    input.form!.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(api.changeLibraryFolder).toHaveBeenCalledExactlyOnceWith(
    "papers",
    "ML/Vision",
    "ML/CV",
  );
  const twisty = host.querySelector<HTMLButtonElement>(
    '[aria-label="折叠“ML”"]',
  )!;
  await act(async () => twisty.click());
  expect(api.saveLibraryPreferences).toHaveBeenCalledWith(
    expect.objectContaining({
      papers: expect.objectContaining({ collapsed: ["ML"] }),
    }),
  );
});

it("merges duplicates into the version with the reading work", async () => {
  await act(async () =>
    useReaderStore.setState({
      documents: [
        { ...docs[0], metadata: { ...docs[0].metadata, doi: "10.1/x" } },
        paper({
          id: "c",
          title: "Attention is all you need (preprint)",
          noteCount: 3,
          metadata: { doi: "10.1/X" },
        }),
        docs[1],
      ],
    }),
  );
  await act(async () => navButton("重复的论文").click());
  expect(host.querySelectorAll("[data-paper-id]")).toHaveLength(2);
  const merge = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "合并…",
  )!;
  await act(async () => merge.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(
    dialog
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.closest("label")?.textContent,
  ).toContain("preprint");
  const confirm = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "合并",
  )!;
  await act(async () => confirm.click());
  expect(api.mergeDocuments).toHaveBeenCalledExactlyOnceWith("c", ["a"]);
});

it("toggles a colored category with its number key", async () => {
  await act(async () =>
    useReaderStore.setState({
      libraryPreferences: {
        mode: "papers",
        papers: {
          sort: "title",
          colorCategories: [
            { name: "Todo", color: "#e5534b" },
            { name: "ML", color: "#4a8fe0" },
          ],
        },
      },
    }),
  );
  expect(
    row("Attention Is All You Need")
      .querySelector(".paper-row-colors")
      ?.getAttribute("aria-label"),
  ).toBe("ML");
  await act(async () => row("Graph Attention Networks").click());
  await act(async () =>
    row("Graph Attention Networks").dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", bubbles: true }),
    ),
  );
  expect(api.update).toHaveBeenCalledExactlyOnceWith("b", {
    folders: ["Todo"],
  });
});

it("links related papers from the detail panel", async () => {
  await act(async () =>
    useReaderStore.setState({
      documents: [{ ...docs[0], related: ["b", "gone"] }, docs[1]],
    }),
  );
  await act(async () => row("Attention Is All You Need").click());
  const section = host.querySelector(".paper-related")!;
  expect(section.textContent).toContain("Graph Attention Networks");
  await act(async () =>
    section
      .querySelector<HTMLButtonElement>(
        '[aria-label="取消关联 Graph Attention Networks"]',
      )!
      .click(),
  );
  expect(api.unrelateDocuments).toHaveBeenCalledExactlyOnceWith("a", "b");
});

it("shows papers as a table and sorts by a column header", async () => {
  await act(async () =>
    useReaderStore.setState({
      libraryPreferences: {
        mode: "papers",
        papers: { sort: "title", layout: "table", columns: ["year", "venue"] },
      },
    }),
  );
  const headers = [...host.querySelectorAll("th")].map((th) =>
    th.textContent?.trim(),
  );
  expect(headers).toEqual(["标题", "年份", "出处", ""]);
  expect(row("Attention Is All You Need").textContent).toContain("2017");
  const year = [...host.querySelectorAll<HTMLButtonElement>("th button")].find(
    (b) => b.textContent === "年份",
  )!;
  await act(async () => year.click());
  expect(api.saveLibraryPreferences).toHaveBeenLastCalledWith(
    expect.objectContaining({
      papers: expect.objectContaining({ sort: "year", sortReverse: false }),
    }),
  );
  const title = host.querySelector('th[data-column="title"]')!;
  expect(title.getAttribute("aria-sort")).toBeNull();
  expect(
    host.querySelector('th[data-column="year"]')!.getAttribute("aria-sort"),
  ).toBe("descending");
});

it("edits authors as capsules", async () => {
  await act(async () => row("Attention Is All You Need").click());
  const detail = host.querySelector(".paper-detail")!;
  expect(detail.textContent).not.toContain("论文详情");
  expect(detail.querySelector('[aria-label="阅读状态"]')).toBeNull();
  const add = detail.querySelector<HTMLButtonElement>(
    'button[aria-label="添加作者"]',
  )!;
  await act(async () => add.click());
  const input = detail.querySelector<HTMLInputElement>(
    'input[aria-label="添加作者"]',
  )!;
  input.value = "Shazeer, Noam";
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(api.update).toHaveBeenLastCalledWith("a", {
    metadata: {
      creators: [
        { given: "Ashish", family: "Vaswani" },
        { family: "Shazeer", given: "Noam" },
      ],
    },
  });
  await act(async () =>
    detail
      .querySelector<HTMLButtonElement>(
        'button[aria-label="删除作者 Ashish Vaswani"]',
      )!
      .click(),
  );
  expect(api.update).toHaveBeenLastCalledWith("a", {
    metadata: { creators: [{ family: "Shazeer", given: "Noam" }] },
  });
});

it("tags a paper and collects it in a smart tag category", async () => {
  await act(async () => row("Graph Attention Networks").click());
  const detail = host.querySelector(".paper-detail")!;
  await act(async () =>
    detail
      .querySelector<HTMLButtonElement>('button[aria-label="添加标签"]')!
      .click(),
  );
  const input = detail.querySelector<HTMLInputElement>(
    'input[aria-label="添加标签"]',
  )!;
  input.value = "#GNN";
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(api.update).toHaveBeenLastCalledWith("b", { tags: ["GNN"] });
  await act(async () =>
    useReaderStore.setState({
      documents: [docs[0], { ...docs[1], tags: ["GNN"] }],
      libraryPreferences: {
        mode: "papers",
        papers: {
          sort: "title",
          smartCategories: [{ id: "s", name: "图网络", tags: ["gnn"] }],
        },
      },
    }),
  );
  await act(async () => navButton("图网络").click());
  expect(host.querySelector(".library-title")?.textContent).toBe("图网络");
  expect(host.querySelectorAll("[data-paper-id]")).toHaveLength(1);
});

it("puts reading and paper actions under the title, the remark first", async () => {
  await act(async () => row("Attention Is All You Need").click());
  const body = host.querySelector(".paper-detail-body")!;
  const [title, open, actions, fields] = [...body.children];
  expect(title.getAttribute("aria-label")).toBe("标题");
  expect(open.textContent).toBe("开始阅读");
  expect(
    [...actions.querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") || b.textContent,
    ),
  ).toEqual(["引用", "加星标", "置顶到侧栏", "更多操作"]);
  expect(fields.querySelector("dt")?.textContent).toBe("备注");
  await act(async () =>
    actions
      .querySelector<HTMLButtonElement>('[aria-label="置顶到侧栏"]')!
      .click(),
  );
  expect(api.saveLibraryPreferences).toHaveBeenLastCalledWith(
    expect.objectContaining({
      papers: expect.objectContaining({ pinned: ["doc:a"] }),
    }),
  );
});


it.each([
  { phase: "learning" as const, label: "解析中", percent: 15 },
  { phase: "translating" as const, label: "翻译中", percent: 25 },
])("shows $label progress beside the table title without the notes column", async ({ phase, label, percent }) => {
  jobs = new Map([["a", {
    documentId: "a", phase, status: "running",
    pagesDone: 3, pagesTotal: 20,
    translationsDone: 5, translationsTotal: 20,
    detail: "", updatedAt: "2026-10-08T00:00:00Z",
  }]]);
  await act(async () => {
    useReaderStore.setState({
      libraryPreferences: {
        mode: "papers",
        papers: { layout: "table", columns: ["year"] },
      },
    });
    root.render(<Harness />);
  });
  const paperRow = row("Attention Is All You Need");
  const progress = paperRow.querySelector('[role="progressbar"]');
  expect(progress).not.toBeNull();
  expect(progress!.closest(".paper-table-title")).not.toBeNull();
  expect(progress!.getAttribute("aria-valuenow")).toBe(String(percent));
  expect(paperRow.textContent).toContain(label);
  expect(paperRow.textContent).not.toMatch(/3\s*\/\s*20|5\s*\/\s*20/);
  expect(paperRow.querySelector('[data-column="notes"]')).toBeNull();
});
