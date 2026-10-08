import type {
  Document,
  PaperLibraryPreferences,
  PaperSort,
  Processing,
  ReadingStatus,
} from "@reader/core";
import { paperCreators, creatorName, paperYear } from "./format";

export type BuiltinView =
  | "all"
  | "reading"
  | "unread"
  | "done"
  | "starred"
  | "processing"
  | "questions"
  | "unfiled";
/** A built-in view, a category ("tag:<name>") or the trash. */
export type PaperView = BuiltinView | `tag:${string}` | "trash";

export const viewLabels: Record<BuiltinView, string> = {
  all: "全部论文",
  reading: "在读",
  unread: "未读",
  done: "已读",
  starred: "星标",
  processing: "解析中",
  questions: "待回答的问题",
  unfiled: "未分类",
};
/** Views the user can hide or pin; "all" is always shown. */
export const managedViews: BuiltinView[] = [
  "reading",
  "unread",
  "done",
  "starred",
];
export const statusLabels: Record<ReadingStatus, string> = {
  unread: "未读",
  reading: "在读",
  done: "已读",
};
export const sortLabels: Record<PaperSort, string> = {
  opened: "最近打开",
  added: "最近添加",
  year: "年份",
  title: "标题",
};

const busy = (job?: Processing) =>
  !!job && !["complete", "failed"].includes(job.status);

/** Categories nest by "/": "ML/Vision" is inside "ML". */
export const categoryParent = (name: string) => {
  const at = name.lastIndexOf("/");
  return at > 0 ? name.slice(0, at) : "";
};
export const categoryLeaf = (name: string) =>
  name.slice(name.lastIndexOf("/") + 1);
/** Whether `tag` is `name` itself or nested anywhere below it. */
export function withinCategory(tag: string, name: string) {
  const a = tag.toLowerCase();
  const b = name.toLowerCase();
  return a === b || a.startsWith(`${b}/`);
}

export function matchesView(
  doc: Document,
  view: PaperView,
  jobs: Map<string, Processing>,
  subcategories = true,
) {
  if (view.startsWith("tag:")) {
    const name = view.slice(4);
    return doc.tags.some((tag) =>
      subcategories
        ? withinCategory(tag, name)
        : tag.toLowerCase() === name.toLowerCase(),
    );
  }
  switch (view) {
    case "reading":
    case "unread":
    case "done":
      return doc.readingStatus === view;
    case "starred":
      return doc.favorite;
    case "processing":
      return busy(jobs.get(doc.id));
    case "questions":
      return doc.openQuestionCount > 0;
    case "unfiled":
      return doc.tags.length === 0;
    default:
      return true;
  }
}

export function searchText(doc: Document) {
  const m = doc.metadata;
  return [
    doc.title,
    m.translatedTitle,
    m.shortTitle,
    paperCreators(doc).map(creatorName).join(" "),
    m.venue,
    m.arxiv,
    m.doi,
    m.date,
    m.abstract,
    doc.tags.join(" "),
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
}

export function sortPapers(docs: Document[], sort: PaperSort) {
  const by: Record<PaperSort, (a: Document, b: Document) => number> = {
    opened: (a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt),
    added: (a, b) => b.createdAt.localeCompare(a.createdAt),
    year: (a, b) =>
      (b.metadata.date || "").localeCompare(a.metadata.date || "") ||
      a.title.localeCompare(b.title, "zh"),
    title: (a, b) => a.title.localeCompare(b.title, "zh"),
  };
  return [...docs].sort(by[sort]);
}

/** Every whitespace-separated term must appear somewhere in the paper. */
export function filterPapers(
  docs: Document[],
  view: PaperView,
  query: string,
  sort: PaperSort,
  jobs: Map<string, Processing>,
  subcategories = true,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sortPapers(
    docs.filter((doc) => {
      if (!matchesView(doc, view, jobs, subcategories)) return false;
      if (!terms.length) return true;
      const text = searchText(doc);
      return terms.every((term) => text.includes(term));
    }),
    sort,
  );
}

/**
 * Saved category order followed by tags that only exist on papers. Parents of
 * nested categories are listed even when no paper is filed directly in them.
 */
export function paperCategories(
  prefs: PaperLibraryPreferences,
  docs: Document[],
) {
  const saved = [...(prefs.categories || [])];
  const known = new Set(saved.map((name) => name.toLowerCase()));
  const extra = new Map<string, string>();
  for (const doc of docs)
    for (const tag of doc.tags)
      if (!known.has(tag.toLowerCase()) && !extra.has(tag.toLowerCase()))
        extra.set(tag.toLowerCase(), tag);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [
    ...saved,
    ...[...extra.values()].sort((a, b) => a.localeCompare(b, "zh")),
  ]) {
    const parts = name.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      if (!path || seen.has(path.toLowerCase())) continue;
      seen.add(path.toLowerCase());
      out.push(path);
    }
  }
  return out;
}

export interface CategoryNode {
  name: string;
  label: string;
  depth: number;
  children: CategoryNode[];
}

/** Categories as a tree; siblings keep their order in `categories`. */
export function categoryTree(categories: string[]) {
  const roots: CategoryNode[] = [];
  const nodes = new Map<string, CategoryNode>();
  for (const name of categories) {
    const parent = nodes.get(categoryParent(name).toLowerCase());
    const node: CategoryNode = {
      name,
      label: categoryLeaf(name) || name,
      depth: parent ? parent.depth + 1 : 0,
      children: [],
    };
    nodes.set(name.toLowerCase(), node);
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** Depth-first order, skipping the children of `collapsed` nodes. */
export function flattenCategories(
  roots: CategoryNode[],
  collapsed: (node: CategoryNode) => boolean = () => false,
): CategoryNode[] {
  return roots.flatMap((node) => [
    node,
    ...(collapsed(node) ? [] : flattenCategories(node.children, collapsed)),
  ]);
}

/** Replace `from` (and everything nested in it) with `to` in a key or name. */
function renamePath(item: string, from: string, to: string, prefix = "") {
  if (!item.startsWith(prefix)) return item;
  const name = item.slice(prefix.length);
  if (!withinCategory(name, from)) return item;
  return prefix + to + name.slice(from.length);
}
const insideKey = (item: string, name: string, prefix: string) =>
  item.startsWith(prefix) && withinCategory(item.slice(prefix.length), name);

/** Trim each level of a category path: " ML / Vision " → "ML/Vision". */
export const cleanCategory = (name: string) =>
  name
    .split("/")
    .map((part) => part.trim())
    .join("/");

export const validCategory = (name: string) =>
  name.split("/").every((part) => part.trim().length > 0) &&
  [...name.trim()].length <= 40 &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(name);

/** Rename a category and its subcategories in every preference list. */
export function renameCategoryPreferences(
  prefs: PaperLibraryPreferences,
  categories: string[],
  from: string,
  to: string,
): PaperLibraryPreferences {
  const swap = (items?: string[]) =>
    items?.map((item) => renamePath(item, from, to, "tag:"));
  return {
    ...prefs,
    categories: categories.map((name) => renamePath(name, from, to)),
    pinned: swap(prefs.pinned),
    hidden: swap(prefs.hidden),
    collapsed: prefs.collapsed?.map((name) => renamePath(name, from, to)),
  };
}

export function removeCategoryPreferences(
  prefs: PaperLibraryPreferences,
  categories: string[],
  name: string,
): PaperLibraryPreferences {
  const drop = (items?: string[]) =>
    items?.filter((item) => !insideKey(item, name, "tag:"));
  return {
    ...prefs,
    categories: categories.filter((item) => !withinCategory(item, name)),
    pinned: drop(prefs.pinned),
    hidden: drop(prefs.hidden),
    collapsed: prefs.collapsed?.filter((item) => !withinCategory(item, name)),
  };
}

/** Swap a category, with its subcategories, and its previous or next sibling. */
export function moveCategory(categories: string[], name: string, by: -1 | 1) {
  const reorder = (nodes: CategoryNode[]): CategoryNode[] => {
    const at = nodes.findIndex((node) => node.name === name);
    if (at < 0)
      return nodes.map((node) => ({
        ...node,
        children: reorder(node.children),
      }));
    const to = at + by;
    if (to < 0 || to >= nodes.length) return nodes;
    const list = [...nodes];
    [list[at], list[to]] = [list[to], list[at]];
    return list;
  };
  return flattenCategories(reorder(categoryTree(categories))).map(
    (node) => node.name,
  );
}

/** Index among siblings and their count, for enabling move up/down. */
export function siblingPosition(categories: string[], name: string) {
  const parent = categoryParent(name).toLowerCase();
  const siblings = categories.filter(
    (item) => categoryParent(item).toLowerCase() === parent,
  );
  return { index: siblings.indexOf(name), count: siblings.length };
}

export function togglePinned(prefs: PaperLibraryPreferences, key: string) {
  const pinned = prefs.pinned || [];
  return {
    ...prefs,
    pinned: pinned.includes(key)
      ? pinned.filter((item) => item !== key)
      : [key, ...pinned],
  };
}

export function setHidden(
  prefs: PaperLibraryPreferences,
  key: string,
  hidden: boolean,
) {
  const items = (prefs.hidden || []).filter((item) => item !== key);
  return { ...prefs, hidden: hidden ? [...items, key] : items };
}

/** Recently opened papers, newest first, excluding pinned ones. */
export function recentPapers(docs: Document[], pinned: string[], limit = 10) {
  return docs
    .filter(
      (doc) =>
        Date.parse(doc.lastOpenedAt) - Date.parse(doc.createdAt) > 1000 &&
        !pinned.includes(`doc:${doc.id}`),
    )
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .slice(0, limit);
}

export { paperYear };
