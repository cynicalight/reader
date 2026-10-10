export type Candidate = {
  title: string;
  sourceUrl: string;
  pdfUrl: string;
  metadata: Record<string, unknown>;
  snapshot: string;
};
export type Detection = { items: Candidate[]; kind: "single" | "list" };

// Self-contained so Chrome can serialize this function for activeTab injection.
export function detectPage(): Detection {
  const meta = (name: string) =>
    (
      document.querySelector(
        `meta[name="${name}"],meta[property="${name}"]`,
      ) as HTMLMetaElement | null
    )?.content?.trim() || "";
  const absolute = (value: string) => {
    if (!value.trim()) return "";
    try {
      const u = new URL(value, location.href);
      return ["https:", "http:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  const text = (value: string) => value.replace(/\s+/g, " ").trim();
  const authors = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="citation_author"]'),
  )
    .map((x) => ({ name: text(x.content) }))
    .filter((x) => x.name);
  const doi =
    meta("citation_doi") ||
    meta("dc.identifier") ||
    (location.href.match(/10\.\d{4,9}\/[^\s?#]+/) || [])[0] ||
    "";
  const arxiv =
    meta("citation_arxiv_id") ||
    (location.hostname.endsWith("arxiv.org")
      ? (location.pathname.match(/\/(?:abs|pdf|html)\/([^/?#]+)/) || [])[1]
      : "") ||
    "";
  let pdf = absolute(meta("citation_pdf_url"));
  if (!pdf && arxiv) pdf = `https://arxiv.org/pdf/${arxiv}`;
  if (!pdf)
    pdf = absolute(
      (
        document.querySelector(
          'link[type="application/pdf"],a[type="application/pdf"],a[href$=".pdf"],a[href*="/pdf/"]',
        ) as HTMLLinkElement | HTMLAnchorElement | null
      )?.href || "",
    );
  const isPDF =
    location.pathname.toLowerCase().endsWith(".pdf") ||
    document.contentType === "application/pdf";
  if (isPDF) pdf = location.href;
  let title =
    meta("citation_title") ||
    meta("dc.title") ||
    meta("og:title") ||
    document.title;
  let abstract =
    meta("citation_abstract") || meta("dc.description") || meta("description");
  let date =
    meta("citation_date") ||
    meta("citation_publication_date") ||
    meta("datePublished");
  let venue =
    meta("citation_journal_title") || meta("citation_conference_title");
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    try {
      const raw = JSON.parse(script.textContent || "null");
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const entry of entries) {
        const item =
          entry?.["@graph"]?.find?.((x: Record<string, unknown>) =>
            /Article|ScholarlyArticle/.test(String(x["@type"])),
          ) || entry;
        if (!item || !/Article|ScholarlyArticle/.test(String(item["@type"])))
          continue;
        title = meta("citation_title") || item.headline || item.name || title;
        abstract = abstract || item.description || "";
        date = date || item.datePublished || "";
        venue = venue || item.isPartOf?.name || "";
        if (!pdf)
          pdf = absolute(
            item.encoding?.contentUrl || item.associatedMedia?.contentUrl || "",
          );
        break;
      }
    } catch {
      /* malformed site metadata */
    }
  }
  const metadata: Record<string, unknown> = {
    title: text(String(title)).slice(0, 300),
    itemType: arxiv ? "preprint" : "journal",
    creators: authors,
    date: String(date).slice(0, 10),
    venue: text(String(venue)).slice(0, 200),
    doi: doi.replace(/^doi:/i, ""),
    arxiv,
    url: location.href,
    abstract: text(String(abstract)).slice(0, 20000),
  };
  const single: Candidate = {
    title: String(metadata.title),
    sourceUrl: location.href,
    pdfUrl: pdf,
    metadata,
    snapshot:
      document.querySelector("main,article")?.outerHTML ||
      document.body?.outerHTML ||
      "",
  };
  const host = location.hostname;
  const cards: Element[] = host.includes("scholar.google.")
    ? Array.from(document.querySelectorAll(".gs_r.gs_or"))
    : host.includes("pubmed.ncbi.nlm.nih.gov")
      ? Array.from(document.querySelectorAll(".docsum-content"))
      : host.includes("semanticscholar.org")
        ? Array.from(
            document.querySelectorAll(
              '[data-test-id="paper-row"],.cl-paper-row',
            ),
          )
        : host.includes("arxiv.org")
          ? Array.from(
              document.querySelectorAll("li.arxiv-result,.arxiv-result"),
            )
          : [];
  const items: Candidate[] = [];
  for (const card of cards.slice(0, 100)) {
    const titleLink = card.querySelector<HTMLAnchorElement>(
      'h3 a,.docsum-title,a[data-test-id="title-link"],p.title a',
    );
    const arxivTitle = card.querySelector("p.title");
    const arxivLink = card.querySelector<HTMLAnchorElement>(
      'p.list-title a[href*="/abs/"]',
    );
    const sourceUrl = absolute(titleLink?.href || arxivLink?.href || "");
    const itemTitle = text(
      titleLink?.textContent || arxivTitle?.textContent || "",
    );
    if (!sourceUrl || !itemTitle) continue;
    const pdfLink = card.querySelector<HTMLAnchorElement>(
      'a[href*=".pdf"],a[href*="/pdf/"],a[href*="/pdf?"]',
    );
    items.push({
      title: itemTitle,
      sourceUrl,
      pdfUrl: absolute(pdfLink?.href || ""),
      metadata: { title: itemTitle, url: sourceUrl, itemType: "journal" },
      snapshot: "",
    });
  }
  return items.length
    ? { items, kind: "list" }
    : { items: [single], kind: "single" };
}
