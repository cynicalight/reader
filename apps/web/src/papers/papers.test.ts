import { expect, it } from "vitest";
import type { Document, Processing } from "@reader/core";
import { paper } from "./fixtures";
import {
  authorsShort,
  formatCreators,
  paperByline,
  paperLink,
  parseCreators,
  shortTitle,
} from "./format";
import {
  filterPapers,
  moveCategory,
  paperCategories,
  recentPapers,
  removeCategoryPreferences,
  renameCategoryPreferences,
  setHidden,
  togglePinned,
} from "./model";

it("formats author lists by script and falls back to the display author", () => {
  const four = paper({
    metadata: {
      creators: [
        { given: "Ashish", family: "Vaswani" },
        { given: "Noam", family: "Shazeer" },
        { given: "Niki", family: "Parmar" },
        { given: "Jakob", family: "Uszkoreit" },
      ],
    },
  });
  expect(authorsShort(four)).toBe(
    "Ashish Vaswani, Noam Shazeer, Niki Parmar et al.",
  );
  expect(authorsShort(paper({ author: "张三，李四；王五, 赵六" }))).toBe(
    "张三, 李四, 王五 等",
  );
  expect(
    paperByline(
      paper({
        author: "Ada",
        metadata: { date: "2017-06-12", arxiv: "1706.03762" },
      }),
    ),
  ).toBe("Ada · 2017 · arXiv:1706.03762");
});

it("parses one author per line and formats them back", () => {
  const creators = parseCreators(
    "Vaswani, Ashish\nNoam Shazeer\n张三\nPlato\n",
  );
  expect(creators).toEqual([
    { family: "Vaswani", given: "Ashish" },
    { given: "Noam", family: "Shazeer" },
    { name: "张三" },
    { name: "Plato" },
  ]);
  expect(formatCreators(creators)).toBe(
    "Vaswani, Ashish\nShazeer, Noam\n张三\nPlato",
  );
});

it("derives links and short titles", () => {
  expect(paperLink({ arxiv: "1706.03762v5" })).toBe(
    "https://arxiv.org/abs/1706.03762",
  );
  expect(paperLink({ doi: "10.1000/x" })).toBe("https://doi.org/10.1000/x");
  expect(paperLink({ url: "https://a.org", doi: "10.1000/x" })).toBe(
    "https://a.org",
  );
  expect(shortTitle(paper({ title: "BERT: Pre-training of Deep" }))).toBe(
    "BERT",
  );
  expect(shortTitle(paper({ title: "AI: A Survey" }))).toBe("AI: A Survey");
  expect(shortTitle(paper({ title: "Scaling Laws: A Study" }))).toBe(
    "Scaling Laws",
  );
  expect(shortTitle(paper({ metadata: { shortTitle: "Transformer" } }))).toBe(
    "Transformer",
  );
});

it("filters by view and every search term, then sorts", () => {
  const docs = [
    paper({
      id: "a",
      title: "Alpha",
      tags: ["ML"],
      readingStatus: "reading",
      metadata: { date: "2020", venue: "NeurIPS" },
    }),
    paper({
      id: "b",
      title: "Beta",
      favorite: true,
      metadata: { date: "2023", abstract: "graph neural networks" },
    }),
    paper({ id: "c", title: "Gamma", tags: ["ml"] }),
  ];
  const jobs = new Map<string, Processing>([
    ["c", { documentId: "c", status: "running" } as Processing],
  ]);
  const ids = (list: Document[]) => list.map((d) => d.id);
  expect(ids(filterPapers(docs, "tag:ML", "", "title", jobs))).toEqual([
    "a",
    "c",
  ]);
  expect(ids(filterPapers(docs, "reading", "", "title", jobs))).toEqual(["a"]);
  expect(ids(filterPapers(docs, "starred", "", "title", jobs))).toEqual(["b"]);
  expect(ids(filterPapers(docs, "processing", "", "title", jobs))).toEqual([
    "c",
  ]);
  expect(
    ids(filterPapers(docs, "all", "graph NETWORKS", "title", jobs)),
  ).toEqual(["b"]);
  expect(ids(filterPapers(docs, "all", "graph alpha", "title", jobs))).toEqual(
    [],
  );
  expect(ids(filterPapers(docs, "all", "", "year", jobs))).toEqual([
    "b",
    "a",
    "c",
  ]);
});

it("keeps saved category order and appends tags found on papers", () => {
  const docs = [paper({ tags: ["Zeta", "alpha"] }), paper({ tags: ["Beta"] })];
  expect(paperCategories({ categories: ["Alpha", "Empty"] }, docs)).toEqual([
    "Alpha",
    "Empty",
    "Beta",
    "Zeta",
  ]);
  expect(moveCategory(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  expect(moveCategory(["a", "b"], "a", -1)).toEqual(["a", "b"]);
});

it("updates pinned and hidden keys when categories change", () => {
  const prefs = {
    pinned: ["tag:ML", "doc:x"],
    hidden: ["tag:ML", "view:done"],
  };
  expect(renameCategoryPreferences(prefs, ["ML", "CV"], "ML", "NLP")).toEqual({
    categories: ["NLP", "CV"],
    pinned: ["tag:NLP", "doc:x"],
    hidden: ["tag:NLP", "view:done"],
  });
  expect(removeCategoryPreferences(prefs, ["ML", "CV"], "ML")).toEqual({
    categories: ["CV"],
    pinned: ["doc:x"],
    hidden: ["view:done"],
  });
  expect(togglePinned({ pinned: ["a"] }, "b").pinned).toEqual(["b", "a"]);
  expect(togglePinned({ pinned: ["a"] }, "a").pinned).toEqual([]);
  expect(setHidden({ hidden: ["x"] }, "x", false).hidden).toEqual([]);
});

it("lists recently opened papers without pinned ones", () => {
  const docs = [
    paper({ id: "new" }),
    paper({ id: "old", lastOpenedAt: "2026-10-03T00:00:00Z" }),
    paper({ id: "pinned", lastOpenedAt: "2026-10-04T00:00:00Z" }),
    paper({ id: "latest", lastOpenedAt: "2026-10-05T00:00:00Z" }),
  ];
  expect(recentPapers(docs, ["doc:pinned"]).map((d) => d.id)).toEqual([
    "latest",
    "old",
  ]);
});
