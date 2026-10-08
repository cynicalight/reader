import type { Creator, Document } from "@reader/core";
import { creatorName, paperCreators, paperLink, paperYear } from "./format";

/**
 * Citations come only from stored metadata; nothing is sent anywhere.
 * GB/T 7714 and APA use CSL (citation-js); BibTeX and RIS are written here
 * because the citation-js writers drop non-Latin titles and venues.
 */
export type CitationStyle = "gb7714" | "apa" | "bibtex" | "ris" | "csl-json";
export type CitationOrder = "author" | "year" | "custom";

export const citationStyles: Record<
  CitationStyle,
  { label: string; extension: string; mime: string }
> = {
  gb7714: { label: "GB/T 7714", extension: "txt", mime: "text/plain" },
  apa: { label: "APA", extension: "txt", mime: "text/plain" },
  bibtex: { label: "BibTeX", extension: "bib", mime: "application/x-bibtex" },
  ris: {
    label: "RIS",
    extension: "ris",
    mime: "application/x-research-info-systems",
  },
  "csl-json": {
    label: "CSL-JSON",
    extension: "json",
    mime: "application/json",
  },
};
export const citationOrders: Record<CitationOrder, string> = {
  author: "按作者",
  year: "按年份",
  custom: "自定义顺序",
};

const han = /\p{Script=Han}/u;
const conferenceVenue =
  /\b(conference|proceedings|workshop|symposium|neurips|nips|icml|iclr|acl|emnlp|naacl|coling|cvpr|iccv|eccv|aaai|ijcai|kdd|sigir|sigmod|vldb|www|chi|uist|osdi|sosp|nsdi)\b/i;

/** The item type, inferred from the venue when it was never set. */
export function citationType(doc: Document) {
  const m = doc.metadata;
  if (m.itemType) return m.itemType;
  if (/^(arxiv|openreview|biorxiv|medrxiv|corr)\b/i.test(m.venue || ""))
    return "preprint";
  if (m.venue && conferenceVenue.test(m.venue)) return "conference";
  if (m.venue) return "journal";
  return m.arxiv ? "preprint" : "other";
}

const cslTypes = {
  journal: "article-journal",
  conference: "paper-conference",
  preprint: "article",
  thesis: "thesis",
  book: "book",
  chapter: "chapter",
  report: "report",
  other: "document",
} as const;

const familyOf = (c: Creator) => c.family || c.name || "";

function latin(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

/** "vaswani2017attention": first author, year and first meaningful title word. */
export function citationKey(doc: Document) {
  const creators = paperCreators(doc);
  const author = latin(familyOf(creators[0] || {})) || "ref";
  const word =
    doc.title
      .split(/\s+/)
      .map(latin)
      .find(
        (w) => w.length > 3 && !["with", "from", "that", "this"].includes(w),
      ) || "";
  return author + paperYear(doc.metadata) + word;
}

/** Keys for a batch; repeated keys get a, b, c… suffixes. */
export function citationKeys(docs: Document[]) {
  const keys = docs.map(citationKey);
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
  const used = new Set(keys);
  const next = new Map<string, number>();
  return keys.map((key) => {
    if (counts.get(key)! < 2) return key;
    let index = next.get(key) || 0,
      candidate = "";
    do candidate = key + String.fromCharCode(97 + index++);
    while (used.has(candidate));
    next.set(key, index);
    used.add(candidate);
    return candidate;
  });
}

const dateParts = (date?: string) =>
  date ? [date.split("-").map((part) => Number(part))] : undefined;

export function toCSL(doc: Document, key = citationKey(doc)) {
  const m = doc.metadata;
  const type = citationType(doc);
  const item: Record<string, unknown> = {
    id: doc.id,
    "citation-key": key,
    type: cslTypes[type],
    title: doc.title,
    author: paperCreators(doc).map((c) =>
      c.name ? { literal: c.name } : { family: c.family, given: c.given },
    ),
    language:
      han.test(doc.title) ||
      paperCreators(doc).some((c) => han.test(creatorName(c)))
        ? "zh-CN"
        : "en-US",
  };
  if (m.date) item.issued = { "date-parts": dateParts(m.date) };
  if (m.venue) item["container-title"] = m.venue;
  if (m.volume) item.volume = m.volume;
  if (m.issue) item.issue = m.issue;
  if (m.pages) item.page = m.pages;
  if (m.publisher) item.publisher = m.publisher;
  if (m.doi) item.DOI = m.doi;
  if (m.isbn) item.ISBN = m.isbn;
  if (m.abstract) item.abstract = m.abstract;
  if (m.shortTitle) item["title-short"] = m.shortTitle;
  const link = m.url || (m.arxiv && !m.doi ? paperLink(m) : "");
  if (link) item.URL = link;
  if (type === "preprint" && m.arxiv) {
    item.publisher = m.publisher || "arXiv";
    item.number = `arXiv:${m.arxiv}`;
  }
  return item;
}

type CiteClass = typeof import("@citation-js/core").Cite;
let engine: Promise<CiteClass> | undefined;
/** Load citeproc and the GB/T 7714 style on first use. */
function loadEngine() {
  engine ??= (async () => {
    const [core, , style, locale] = await Promise.all([
      import("@citation-js/core"),
      import("@citation-js/plugin-csl"),
      import("./csl/china-national-standard-gb-t-7714-2015-numeric.csl?raw"),
      import("./csl/locales-zh-CN.xml?raw"),
    ]);
    const config = core.plugins.config.get("@csl") as {
      styles: { add: (name: string, xml: string) => void };
      locales: { add: (name: string, xml: string) => void };
    };
    config.styles.add("gb7714", style.default);
    config.locales.add("zh-CN", locale.default);
    return core.Cite;
  })();
  return engine;
}

async function bibliography(docs: Document[], style: "gb7714" | "apa") {
  const Cite = await loadEngine();
  const keys = citationKeys(docs);
  const items = docs.map((doc, i) => toCSL(doc, keys[i]));
  const format = (data: unknown[], lang: string) =>
    String(
      new Cite(data).format("bibliography", {
        format: "text",
        template: style,
        lang,
      }),
    ).trim();
  if (style === "apa") return format(items, "en-US");
  // GB/T 7714 writes "et al." for Western references and "等" for Chinese ones,
  // so each entry uses its own language and keeps its position number.
  return items
    .map(
      (item, i) =>
        `[${i + 1}] ` +
        format([item], String(item.language)).replace(/^\[\d+\]\s*/, ""),
    )
    .join("\n");
}

function bibEscape(value: string) {
  const escapes: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}",
  };
  return value.replace(/[\\&%$#_{}^~]/g, (c) => escapes[c] || "\\" + c);
}
/** Identifiers are not TeX text: only strip characters that break the entry. */
const ident = (value: string) => value.replace(/[{}\r\n]/g, "");

const bibTypes = {
  journal: ["article", "journal"],
  conference: ["inproceedings", "booktitle"],
  preprint: ["misc", ""],
  thesis: ["phdthesis", ""],
  book: ["book", ""],
  chapter: ["incollection", "booktitle"],
  report: ["techreport", ""],
  other: ["misc", "howpublished"],
} as const;

export function bibtex(docs: Document[]) {
  const keys = citationKeys(docs);
  return docs
    .map((doc, i) => {
      const m = doc.metadata;
      const type = citationType(doc);
      const [entry, venueField] = bibTypes[type];
      const fields: [string, string][] = [
        ["title", `{${bibEscape(doc.title)}}`],
        [
          "author",
          paperCreators(doc)
            .map((c) =>
              c.name
                ? `{${bibEscape(c.name)}}`
                : bibEscape([c.family, c.given].filter(Boolean).join(", ")),
            )
            .join(" and "),
        ],
        ["year", bibEscape(paperYear(m))],
      ];
      if (venueField && m.venue) fields.push([venueField, bibEscape(m.venue)]);
      if (m.volume) fields.push(["volume", bibEscape(m.volume)]);
      if (m.issue) fields.push(["number", bibEscape(m.issue)]);
      if (m.pages)
        fields.push(["pages", bibEscape(m.pages.replace(/\s*[-–]+\s*/, "--"))]);
      if (m.publisher)
        fields.push([
          type === "thesis"
            ? "school"
            : type === "report"
              ? "institution"
              : "publisher",
          bibEscape(m.publisher),
        ]);
      if (m.isbn) fields.push(["isbn", ident(m.isbn)]);
      if (type === "preprint" && m.arxiv)
        fields.push(["eprint", ident(m.arxiv)], ["archivePrefix", "arXiv"]);
      if (m.doi) fields.push(["doi", ident(m.doi)]);
      const link = m.url || (m.arxiv ? paperLink(m) : "");
      if (link) fields.push(["url", ident(link)]);
      return `@${entry}{${keys[i]},\n${fields
        .filter(([, value]) => value)
        .map(([name, value]) => `  ${name} = {${value}}`)
        .join(",\n")}\n}`;
    })
    .join("\n\n");
}

const risTypes = {
  journal: "JOUR",
  conference: "CPAPER",
  preprint: "UNPB",
  thesis: "THES",
  book: "BOOK",
  chapter: "CHAP",
  report: "RPRT",
  other: "GEN",
} as const;

export function ris(docs: Document[]) {
  return docs
    .map((doc) => {
      const m = doc.metadata;
      const lines: [string, string][] = [["TY", risTypes[citationType(doc)]]];
      lines.push(["TI", doc.title]);
      for (const c of paperCreators(doc))
        lines.push([
          "AU",
          c.name || [c.family, c.given].filter(Boolean).join(", "),
        ]);
      if (m.venue) lines.push(["T2", m.venue]);
      if (paperYear(m)) lines.push(["PY", paperYear(m)]);
      if (m.date) {
        const [y, mo = "", d = ""] = m.date.split("-");
        lines.push(["DA", `${y}/${mo}/${d}/`]);
      }
      if (m.volume) lines.push(["VL", m.volume]);
      if (m.issue) lines.push(["IS", m.issue]);
      if (m.pages) {
        const [start, end] = m.pages.split(/\s*[-–]+\s*/);
        lines.push(["SP", start]);
        if (end) lines.push(["EP", end]);
      }
      if (m.publisher) lines.push(["PB", m.publisher]);
      if (m.isbn) lines.push(["SN", m.isbn]);
      if (m.doi) lines.push(["DO", m.doi]);
      if (m.arxiv) lines.push(["AN", `arXiv:${m.arxiv}`]);
      const link = paperLink(m);
      if (link) lines.push(["UR", link]);
      if (m.abstract) lines.push(["AB", m.abstract.replace(/\s*\n\s*/g, " ")]);
      lines.push(["ER", ""]);
      return lines
        .map(([tag, value]) => `${tag}  - ${value.replace(/[\r\n]+/g, " ")}`)
        .join("\n");
    })
    .join("\n\n");
}

export async function formatCitations(docs: Document[], style: CitationStyle) {
  if (!docs.length) return "";
  switch (style) {
    case "gb7714":
    case "apa":
      return bibliography(docs, style);
    case "bibtex":
      return bibtex(docs);
    case "ris":
      return ris(docs);
    case "csl-json": {
      const keys = citationKeys(docs);
      return JSON.stringify(
        docs.map((doc, i) => toCSL(doc, keys[i])),
        null,
        2,
      );
    }
  }
}

/** Fields a style needs that this paper lacks. */
export function missingFields(doc: Document, style: CitationStyle) {
  const missing: string[] = [];
  if (!paperCreators(doc).length) missing.push("作者");
  if (!paperYear(doc.metadata)) missing.push("年份");
  if (
    (style === "gb7714" || style === "apa") &&
    !doc.metadata.venue &&
    !doc.metadata.arxiv &&
    !doc.metadata.publisher
  )
    missing.push("出处");
  return missing;
}

export function orderForCitation(docs: Document[], order: CitationOrder) {
  if (order === "custom") return docs;
  const first = (doc: Document) => {
    const c = paperCreators(doc)[0];
    return c ? familyOf(c) || creatorName(c) : "";
  };
  return [...docs].sort((a, b) =>
    order === "year"
      ? (a.metadata.date || "9999").localeCompare(b.metadata.date || "9999") ||
        first(a).localeCompare(first(b), "zh-CN")
      : first(a).localeCompare(
          first(b),
          han.test(first(a)) && han.test(first(b)) ? "zh-CN-u-co-pinyin" : "en",
          { sensitivity: "base" },
        ) || a.title.localeCompare(b.title, "en"),
  );
}

export const titleAndLink = (doc: Document) =>
  [
    doc.metadata.translatedTitle
      ? `${doc.title}（${doc.metadata.translatedTitle}）`
      : doc.title,
    paperLink(doc.metadata),
  ]
    .filter(Boolean)
    .join("\n");
