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
/** Books and papers are separate libraries; papers are PDFs up to 150 pages and 50 MB. */
export type LibraryMode = "books" | "papers";
export type PaperItemType =
  | "journal"
  | "conference"
  | "preprint"
  | "thesis"
  | "book"
  | "chapter"
  | "report"
  | "other";
/** CSL-style name: given/family for split names, name for one literal name. */
export interface Creator {
  given?: string;
  family?: string;
  name?: string;
}
export type MetadataSource = "file" | "lookup" | "manual";
export interface PaperMetadata {
  itemType?: PaperItemType;
  translatedTitle?: string;
  shortTitle?: string;
  creators?: Creator[];
  affiliation?: string;
  /** YYYY, YYYY-MM or YYYY-MM-DD. */
  date?: string;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  doi?: string;
  arxiv?: string;
  isbn?: string;
  url?: string;
  abstract?: string;
  language?: string;
  /** Where each field came from; lookups never replace manual values. */
  sources?: Partial<Record<string, MetadataSource>>;
  /** Automatic lookup state for papers imported from files. */
  lookup?: "pending" | "done" | "notFound" | "failed";
  lookedUpAt?: string;
}
export type PaperMetadataField = Exclude<
  keyof PaperMetadata,
  "sources" | "lookup" | "lookedUpAt"
>;
export type ReadingStatus = "unread" | "reading" | "done";
export type PaperSort = "opened" | "added" | "year" | "title";
export interface PaperLibraryPreferences {
  /** Category (tag) order, including categories without papers. */
  categories?: string[];
  /** Pinned sidebar entries: "view:<id>", "tag:<name>" or "doc:<id>". */
  pinned?: string[];
  /** Hidden built-in views ("view:<id>") and categories ("tag:<name>"). */
  hidden?: string[];
  sort?: PaperSort;
  /** Look up metadata from the DOI or arXiv ID printed in imported PDFs. */
  autoLookup?: boolean;
  citationStyle?: "gb7714" | "apa" | "bibtex" | "ris" | "csl-json";
  citationOrder?: "author" | "year" | "custom";
}
export interface LibraryPreferences {
  mode?: LibraryMode;
  papers?: PaperLibraryPreferences;
}
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
  library: LibraryMode;
  /** Set while the document is in the trash. */
  deletedAt?: string;
  metadata: PaperMetadata;
  readingStatus: ReadingStatus;
  noteCount: number;
  /** Highlights and underlines. */
  highlightCount: number;
  /** Questions without an answer that are not resolved. */
  openQuestionCount: number;
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
  kind: "highlight" | "underline" | "note" | "question" | "bookmark";
  location: DocumentLocation;
  quote: string;
  /** The note text, or the question for a question. */
  note: string;
  color: string;
  createdAt: string;
  /** Chat message that answers a question. */
  answerId?: string;
  /** A question closed without an answer. */
  resolved?: boolean;
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
/** The target region of a hovered internal PDF link, rendered as an image. */
export interface LinkPreview {
  /** The link's rectangle in viewport coordinates. */
  anchor: { left: number; top: number; width: number; height: number };
  page: number;
  image: string;
  /** Image width divided by height. */
  ratio: number;
}
export interface ReaderEvents {
  /** Show (or hide with null) a preview of an internal link's target. */
  linkPreview?: (preview: LinkPreview | null) => void;
  /** An internal link is about to move away from this location. */
  internalLink?: (origin: DocumentLocation) => void;
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
  /** Whether most of a remembered viewport position is on screen again. */
  isNear?(location: DocumentLocation): boolean;
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

export interface ProcessingStage {
  status: "queued" | "running" | "waiting" | "failed" | "complete";
  detail: string;
  warning?: string;
}
export interface Processing {
  translating?: ProcessingStage;
  usageTracked?: boolean;
  startedAt?: string;
  completedAt?: string;
  incomplete?: boolean;
  documentId: string;
  phase: "learning" | "translating" | "ready";
  status: "queued" | "running" | "waiting" | "failed" | "complete";
  pagesDone: number;
  pagesTotal: number;
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
  formulaMarkdown?: string;
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
