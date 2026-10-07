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
  | "questions";
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

export function matchesView(
  doc: Document,
  view: PaperView,
  jobs: Map<string, Processing>,
) {
  if (view.startsWith("tag:")) {
    const name = view.slice(4).toLowerCase();
    return doc.tags.some((tag) => tag.toLowerCase() === name);
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
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sortPapers(
    docs.filter((doc) => {
      if (!matchesView(doc, view, jobs)) return false;
      if (!terms.length) return true;
      const text = searchText(doc);
      return terms.every((term) => text.includes(term));
    }),
    sort,
  );
}

/** Saved category order followed by tags that only exist on papers. */
export function paperCategories(
  prefs: PaperLibraryPreferences,
  docs: Document[],
) {
  const out = [...(prefs.categories || [])];
  const seen = new Set(out.map((name) => name.toLowerCase()));
  const extra = new Map<string, string>();
  for (const doc of docs)
    for (const tag of doc.tags)
      if (!seen.has(tag.toLowerCase()) && !extra.has(tag.toLowerCase()))
        extra.set(tag.toLowerCase(), tag);
  return [
    ...out,
    ...[...extra.values()].sort((a, b) => a.localeCompare(b, "zh")),
  ];
}

export const validCategory = (name: string) =>
  name.trim().length > 0 &&
  [...name.trim()].length <= 40 &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(name);

/** Rename a key in pinned/hidden lists and the category order. */
export function renameCategoryPreferences(
  prefs: PaperLibraryPreferences,
  categories: string[],
  from: string,
  to: string,
): PaperLibraryPreferences {
  const key = (name: string) => `tag:${name}`;
  const swap = (items?: string[]) =>
    items?.map((item) => (item === key(from) ? key(to) : item));
  return {
    ...prefs,
    categories: categories.map((name) => (name === from ? to : name)),
    pinned: swap(prefs.pinned),
    hidden: swap(prefs.hidden),
  };
}

export function removeCategoryPreferences(
  prefs: PaperLibraryPreferences,
  categories: string[],
  name: string,
): PaperLibraryPreferences {
  const drop = (items?: string[]) =>
    items?.filter((item) => item !== `tag:${name}`);
  return {
    ...prefs,
    categories: categories.filter((item) => item !== name),
    pinned: drop(prefs.pinned),
    hidden: drop(prefs.hidden),
  };
}

export function moveCategory(categories: string[], name: string, by: -1 | 1) {
  const list = [...categories];
  const from = list.indexOf(name);
  const to = from + by;
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
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
