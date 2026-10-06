export { zoomCommand } from "./zoom-shortcut";

export type PDFLocation = {
  type: "pdf";
  page: number;
  x?: number;
  y?: number;
  quote?: string;
  translation?: {
    blockId: string;
    sourceHash: string;
    sentenceIndexes: number[];
    start: number;
    end: number;
    ranges?: {
      blockId: string;
      sourceHash: string;
      sentenceIndexes: number[];
      start: number;
      end: number;
      quote: string;
    }[];
  };
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
export type DocumentCategory = "book" | "article" | "paper";
export interface TagBoard {
  id: string;
  name: string;
  tags: string[];
  match: "all" | "any";
}
export interface Document {
  category: DocumentCategory;
  categorySource: "default" | "ai" | "manual";
  classificationStatus: "pending" | "running" | "failed" | "done";
  classificationError: string;
  tags: string[];
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
export interface SelectionAnchor {
  x: number;
  top: number;
  bottom: number;
}
export interface ReaderSelection {
  /** Transient renderer viewport position; never persist as a document anchor. */
  anchor?: SelectionAnchor;
  text: string;
  location: DocumentLocation;
}
export interface ReaderAnnotationTarget {
  ids: string[];
  anchor: SelectionAnchor;
}
export type Appearance = "light" | "dark" | "system";
export interface ReaderTheme {
  appearance?: Appearance;
  mode: "light" | "sepia" | "dark";
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  margin: number;
  scroll: boolean;
  zoom: number | "width";
}
export const defaultTheme: ReaderTheme = {
  appearance: "system",
  mode: "light",
  fontSize: 1.15,
  fontFamily: "serif",
  lineHeight: 1.8,
  margin: 40,
  scroll: false,
  zoom: "width",
};
export type PDFBlockAction = "attach" | "preview" | "explain" | "translate";
export interface PDFReadingAnchor {
  blockId: string;
  fraction: number;
}
export interface PDFPassage {
  blockId: string;
  sources: string[];
  /** Offset in source text after removing whitespace and soft hyphens. */
  sourceOffset?: number;
}
export interface PDFSentenceLink {
  blockId: string;
  sentenceIndexes: number[];
}
export interface ReaderEvents {
  blockHover?: (block: PDFBlock | null) => void;
  annotation?: (target: ReaderAnnotationTarget | null) => void;
  zoom?: (zoom: ReaderTheme["zoom"]) => void;
  readingAnchor?: (anchor: PDFReadingAnchor) => void;
  blockFocus?: (block: PDFBlock) => void;
  blockAction?: (block: PDFBlock, action: PDFBlockAction) => void;
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
  clearSelection(): void;
  highlight(annotations: Annotation[]): Promise<void>;
  setTheme(theme: ReaderTheme): Promise<void>;
  getContext(): Promise<string>;
  setBlocks?(blocks: PDFBlock[]): void;
  hoverBlock?(blockId: string | null): void;
  renderBlockImage?(blockId: string, signal: AbortSignal): Promise<Blob>;
  followBlock?(anchor: PDFReadingAnchor): Promise<void>;
  focusSentences?(
    blockId: string,
    sources: string[],
    scroll?: boolean,
  ): Promise<void>;
  focusPassages?(passages: PDFPassage[], scroll?: boolean): Promise<void>;
  matchSentences?(
    location: PDFLocation,
    translations: TranslationBlock[],
  ): Promise<PDFSentenceLink[]>;
  focusBlock?(blockId: string, layout: "source" | "parallel"): Promise<void>;
  cancelBlockFocus?(): void;
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
export interface SourceReference {
  text: string;
  location: DocumentLocation;
  kind?: "selection" | "section";
}
export interface ImageAttachment {
  id: string;
  page: number;
  label: string;
  caption?: string;
}
export interface Message {
  attachments?: ImageAttachment[];
  context?: string;
  references?: SourceReference[];
  id: string;
  documentId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Processing {
  usageTracked?: boolean;
  startedAt?: string;
  completedAt?: string;
  incomplete?: boolean;
  documentId: string;
  phase: "learning" | "settling" | "translating" | "ready";
  status: "queued" | "running" | "waiting" | "failed" | "complete";
  pagesDone: number;
  pagesTotal: number;
  assetsDone: number;
  assetsTotal: number;
  translationsDone: number;
  translationsTotal: number;
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
export interface TranslationSentence {
  source: string;
  target: string;
}
export interface TranslationBlock {
  blockId: string;
  sourceHash: string;
  status: "pending" | "running" | "complete" | "failed";
  sentences: TranslationSentence[];
  error?: string;
}
export interface AICapability {
  pendingVision?: boolean;
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
export type ReasoningEffort = "low" | "medium" | "high" | "max";

export interface AIConfig {
  primary: string;
  models: Record<string, string>;
  efforts?: Record<string, Record<string, ReasoningEffort>>;
  textAPI: APIConnection;
  imageAPI: APIConnection;
  capabilities: Record<string, AICapability>;
}
export interface AgentModel {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  aliases?: string[];
}

export { isPDFPageDecoration } from "./pdf-content";

export { pdfFontAscent } from "./pdf-text";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  reasoningOutputTokens: number | null;
}
export interface ModelTokens {
  model: string;
  tokens: TokenCounts | null;
}
export interface UsageCall {
  id: string;
  stage: string;
  target: string;
  provider: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  models: ModelTokens[];
}
export interface UsageGroup {
  stage: string;
  provider: string;
  model: string;
  calls: number;
  unknownCalls: number;
  tokens: TokenCounts;
}
export interface ProcessingUsage {
  historyComplete: boolean;
  total: TokenCounts;
  calls: UsageCall[];
  groups: UsageGroup[];
  stages: { stage: string; durationMs: number }[];
  unknownCalls: number;
  failedCalls: number;
  partialCalls: number;
  elapsedMs: number;
}
