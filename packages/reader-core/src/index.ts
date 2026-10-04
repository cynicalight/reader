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
  setBlocks?(blocks: PDFBlock[]): void;
  destroy(): Promise<void>;
}
export function locationLabel(location?: DocumentLocation): string {
  if (!location) return "尚未开始";
  return location.type === "pdf"
    ? `第 ${location.page} 页`
    : `章节进度 ${Math.round((location.progression ?? 0) * 100)}%`;
}
export interface Provider {
  id: "codex" | "claude" | "kimi";
  installed: boolean;
  authenticated: boolean;
  status: string;
}
export interface Message {
  context?: string;
  references?: ReaderSelection[];
  id: string;
  documentId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Processing {
  incomplete?: boolean;
  documentId: string;
  phase: "learning" | "settling" | "ready";
  status: "queued" | "running" | "waiting" | "failed" | "complete";
  pagesDone: number;
  pagesTotal: number;
  assetsDone: number;
  assetsTotal: number;
  detail: string;
  warning?: string;
  updatedAt: string;
}
export interface PDFBlock {
  id: string;
  page: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  text: string;
  image?: string;
  caption?: string;
}
export interface AICapability {
  text: boolean;
  vision: boolean;
  checkedAt: string;
  error?: string;
}
export interface APIConnection {
  url: string;
  model: string;
  key?: string;
  hasKey: boolean;
}
export interface AIConfig {
  primary: string;
  models: Record<string, string>;
  textAPI: APIConnection;
  imageAPI: APIConnection;
  capabilities: Record<string, AICapability>;
}
