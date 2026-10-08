/** `reader://open?id=<document>[&annotation=<id>][&page=<n>]` opens a place in the library. */
export const READER_SCHEME = "reader";

export interface ReaderLinkTarget {
  id: string;
  annotation?: string;
  page?: number;
}

const hash = /^[0-9a-f]{32}$/;

export function readerLink(target: ReaderLinkTarget) {
  const query = new URLSearchParams({ id: target.id });
  if (target.annotation) query.set("annotation", target.annotation);
  if (target.page) query.set("page", String(target.page));
  return `${READER_SCHEME}://open?${query}`;
}

/** Only the open action with known, well-formed parameters is accepted. */
export function parseReaderLink(link: string): ReaderLinkTarget | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const action = url.hostname || url.pathname.replace(/^\/+/, "");
  if (url.protocol !== `${READER_SCHEME}:` || action !== "open") return null;
  const id = url.searchParams.get("id") || "";
  if (!hash.test(id)) return null;
  const target: ReaderLinkTarget = { id };
  const annotation = url.searchParams.get("annotation");
  if (annotation && hash.test(annotation)) target.annotation = annotation;
  const page = Number(url.searchParams.get("page"));
  if (Number.isInteger(page) && page > 0 && page < 100000) target.page = page;
  return target;
}
