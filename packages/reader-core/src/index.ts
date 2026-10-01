export type PDFLocation = {
  type: "pdf";
  page: number;
  x?: number;
  y?: number;
  quote?: string;
  rects?: { x: number; y: number; width: number; height: number }[];
};
export type EPUBLocation = {
  type: "epub";
  href: string;
  locator?: string;
  progression?: number;
  quote?: string;
};
export type DocumentLocation = PDFLocation | EPUBLocation;
export interface Document {
  id: string;
  type: "epub" | "pdf";
  title: string;
  author: string;
  size: number;
  createdAt: string;
  lastOpenedAt: string;
  favorite: boolean;
  progress?: DocumentLocation;
  percentage: number;
}
export interface TOCItem {
  id: string;
  label: string;
  location: DocumentLocation;
  children: TOCItem[];
}
export interface Annotation {
  id: string;
  documentId: string;
  kind: "highlight" | "underline" | "note" | "bookmark";
  location: DocumentLocation;
  quote: string;
  note: string;
  color: string;
  createdAt: string;
}
export interface SearchResult {
  id: string;
  excerpt: string;
  location: DocumentLocation;
}
export interface ReaderSelection {
  text: string;
  location: DocumentLocation;
}
export interface ReaderTheme {
  mode: "light" | "sepia" | "dark";
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  margin: number;
  scroll: boolean;
  zoom: number | "width";
}
export const defaultTheme: ReaderTheme = {
  mode: "light",
  fontSize: 1.15,
  fontFamily: "serif",
  lineHeight: 1.8,
  margin: 40,
  scroll: false,
  zoom: "width",
};
export interface ReaderEvents {
  location: (location: DocumentLocation, percentage: number) => void;
  selection: (selection: ReaderSelection | null) => void;
}
export interface ReaderAdapter {
  open(document: Document): Promise<void>;
  getTOC(): Promise<TOCItem[]>;
  getLocation(): DocumentLocation;
  goTo(location: DocumentLocation): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  search(query: string): Promise<SearchResult[]>;
  getSelection(): ReaderSelection | null;
  highlight(annotations: Annotation[]): Promise<void>;
  setTheme(theme: ReaderTheme): Promise<void>;
  getContext(): Promise<string>;
  destroy(): Promise<void>;
}
export function locationLabel(location?: DocumentLocation): string {
  if (!location) return "尚未开始";
  return location.type === "pdf"
    ? `第 ${location.page} 页`
    : `章节进度 ${Math.round((location.progression ?? 0) * 100)}%`;
}
export interface Provider {
  id: "codex" | "claude";
  installed: boolean;
  authenticated: boolean;
  status: string;
}
export interface Message {
  id: string;
  documentId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
