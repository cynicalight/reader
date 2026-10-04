import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  PanelLeft,
  PanelRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ListTree,
  Search,
  BookmarkPlus,
  Sparkles,
  Settings2,
  Highlighter,
  Underline,
  Languages,
  MessageSquare,
  X,
  StickyNote,
  Send,
  Square,
  Trash2,
  Download,
  Quote,
  Type,
  Sun,
  Moon,
  AlignJustify,
  Check,
} from "lucide-react";
import { api, chat, blockImageURL } from "@reader/api";
import {
  locationLabel,
  type Annotation,
  type Document as ReaderDocument,
  type DocumentLocation,
  type Message,
  type SourceReference,
  type ReaderAdapter,
  type ReaderSelection,
  type TOCItem,
  type SearchResult,
  type ReaderTheme,
  type Processing,
  type PDFBlock,
  type PDFBlockAction,
  type ImageAttachment,
} from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Badge } from "@reader/ui/components/badge";
import { Input } from "@reader/ui/components/input";
import { Textarea } from "@reader/ui/components/textarea";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@reader/ui/components/tabs";
import { ScrollArea } from "@reader/ui/components/scroll-area";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@reader/ui/components/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";
import {
  ResizablePanelGroup,
  ResizablePanel,
  usePanelRef,
  ResizableHandle,
} from "@reader/ui/components/resizable";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@reader/ui/components/tooltip";
import { toast } from "sonner";
import { ProviderIdentity } from "./ProviderIdentity";
import { SourceReferences } from "./SourceReferences";
import { ImagePreview, imageLabel } from "./ImagePreview";
import { contextReferences } from "./references";
import { ReferenceNavigation } from "./reference-navigation";
import { SelectionToolbar } from "./SelectionToolbar";
import { ReaderView } from "./ReaderView";
import { useReaderStore } from "./store";
import { scheduleProgress, flushProgress } from "./progress";
function IconButton({
  label,
  children,
  onClick,
  active = false,
  expanded,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  expanded?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-expanded={expanded}
            size="icon-sm"
            variant={active ? "secondary" : "ghost"}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
function TOCTree({
  items,
  go,
  location,
  depth = 0,
}: {
  items: TOCItem[];
  go: (location: DocumentLocation) => void;
  location?: DocumentLocation;
  depth?: number;
}) {
  return (
    <div className="toc-tree">
      {items.map((item) => {
        const selected =
          item.location.type === location?.type &&
          (item.location.type === "pdf"
            ? item.location.page === (location as { page: number }).page
            : item.location.href.split("#")[0] ===
              (location as { href: string }).href?.split("#")[0]);
        return (
          <div key={item.id}>
            <Button
              variant="ghost"
              className={`toc-item ${selected ? "selected" : ""}`}
              style={{ paddingLeft: Math.min(12 + depth * 14, 96) }}
              title={item.label}
              onClick={() => go(item.location)}
            >
              {item.children.length > 0 ? (
                <ChevronDown className="size-3 shrink-0" />
              ) : (
                <span className="toc-dot" />
              )}
              <span>{item.label}</span>
              {item.location.type === "pdf" && (
                <small>{item.location.page}</small>
              )}
            </Button>
            {item.children.length > 0 && (
              <TOCTree
                items={item.children}
                go={go}
                location={location}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
export function Workspace({
  document: doc,
  theme,
  processing,
  onBack,
  onSettings,
}: {
  document: ReaderDocument;
  theme: ReaderTheme;
  processing?: Processing;
  onBack: () => void;
  onSettings: () => void;
}) {
  const { setTheme } = useReaderStore();
  const [blocks, setBlocks] = useState<PDFBlock[]>([]);
  const [adapter, setAdapter] = useState<ReaderAdapter>();
  const renderBlockImage = useMemo(
    () => adapter?.renderBlockImage?.bind(adapter),
    [adapter],
  );
  const referenceNavigation = useMemo(
    () => (adapter ? new ReferenceNavigation(adapter) : undefined),
    [adapter],
  );
  const [returnLocation, setReturnLocation] = useState<DocumentLocation>();
  const [referenceBusy, setReferenceBusy] = useState(false);
  const visitReference = async (target: DocumentLocation) => {
    if (!referenceNavigation || referenceNavigation.busy) return;
    setReferenceBusy(true);
    try {
      await referenceNavigation.visit(target);
      setReturnLocation(referenceNavigation.origin);
    } finally {
      setReferenceBusy(false);
    }
  };
  const returnFromReference = async () => {
    if (!referenceNavigation) return;
    setReferenceBusy(true);
    try {
      await referenceNavigation.back();
      setReturnLocation(referenceNavigation.origin);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReferenceBusy(false);
    }
  };
  const [toc, setTOC] = useState<TOCItem[]>([]);
  const [location, setLocation] = useState<DocumentLocation | undefined>(
    doc.progress,
  );
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const leftPanel = usePanelRef();
  const rightPanel = usePanelRef();
  const panelGroup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = panelGroup.current;
    const changes = [
      [leftPanel.current, left],
      [rightPanel.current, right],
    ] as const;
    if (
      !group ||
      !changes.some(([panel, open]) => panel && panel.isCollapsed() === open)
    )
      return;
    group.setAttribute("data-toggling", "");
    for (const [panel, open] of changes) {
      if (panel && panel.isCollapsed() === open) {
        if (open) panel.expand();
        else panel.collapse();
      }
    }
    const timer = setTimeout(() => group.removeAttribute("data-toggling"), 240);
    return () => {
      clearTimeout(timer);
      group.removeAttribute("data-toggling");
    };
  }, [left, right, leftPanel, rightPanel]);
  const [rightTab, setRightTab] = useState("ai");
  const [leftTab, setLeftTab] = useState("toc");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteSelection, setNoteSelection] = useState<ReaderSelection | null>(
    null,
  );
  const readingPane = useRef<HTMLDivElement>(null);
  const [provider, setProvider] = useState("codex");
  const [prompt, setPrompt] = useState("");
  const [quotes, setQuotes] = useState<ReaderSelection[]>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<ImageAttachment>();
  const composeInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    void api
      .aiConfig()
      .then((config) => {
        if (config.primary) setProvider(config.primary);
      })
      .catch(() => {});
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stream, setStream] = useState("");
  const [sending, setSending] = useState(false);
  const [pageInput, setPageInput] = useState("");
  const abort = useRef<AbortController | null>(null);
  const searchSerial = useRef(0);
  const messageEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([api.annotations(doc.id), api.messages(doc.id)])
      .then(([a, m]) => {
        if (alive) {
          setAnnotations(a);
          setMessages(m);
        }
      })
      .catch((e) => toast.error(e.message));
    return () => {
      alive = false;
      abort.current?.abort();
      void flushProgress().catch((e) => toast.error(e.message));
    };
  }, [doc.id]);
  useEffect(() => {
    if (doc.type !== "pdf" || processing?.phase === "learning") return;
    let alive = true;
    void api
      .blocks(doc.id)
      .then((value) => {
        if (alive) setBlocks(value);
      })
      .catch((e) => toast.error(e.message));
    return () => {
      alive = false;
    };
  }, [doc.id, doc.type, processing?.phase]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, stream]);
  const move = (next: DocumentLocation) => {
    void adapter?.goTo(next).catch((e) => toast.error(e.message));
  };
  const saveLocation = (next: DocumentLocation, percent: number) => {
    setLocation(next);
    if (next.type === "pdf") setPageInput(String(next.page));
    scheduleProgress(doc.id, { progress: next, percentage: percent }, (e) =>
      toast.error(e.message),
    );
  };
  const annotate = async (kind: Annotation["kind"], noteText = "") => {
    const source = kind === "note" ? noteSelection : selection;
    const target = kind === "bookmark" ? location : source?.location;
    if (!target) return;
    try {
      const a = await api.annotate(doc.id, {
        kind,
        location: target,
        quote: kind === "bookmark" ? "" : source?.text || "",
        note: noteText,
        color: "#e6b94c",
      });
      setAnnotations((items) => [...items, a]);
      toast.success(kind === "bookmark" ? "已添加书签" : "批注已保存");
      setNoteOpen(false);
      setNoteSelection(null);
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const search = async () => {
    if (!adapter) return;
    const serial = ++searchSerial.current;
    setSearching(true);
    try {
      const found = await adapter.search(query.trim());
      if (serial === searchSerial.current) setResults(found);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (serial === searchSerial.current) setSearching(false);
    }
  };
  const addQuote = () => {
    if (selection) {
      setQuotes((items) => [...items, selection].slice(-6));
      setRight(true);
      setRightTab("ai");
      adapter?.clearSelection();
      setSelection(null);
    }
  };
  const send = async (
    question = prompt,
    selected = quotes,
    useSection = false,
    attachments = images,
    directImage = false,
  ) => {
    if (sending) return;
    if (!question.trim() && attachments.length)
      question = "请解释附件中的图表或公式。";
    if (!question.trim()) return;
    setSending(true);
    setStream("");
    setRight(true);
    setRightTab("ai");
    const controller = new AbortController();
    abort.current = controller;
    try {
      let context = selected
        .map(
          (s, i) => `[选区 ${i + 1} · ${locationLabel(s.location)}]\n${s.text}`,
        )
        .join("\n\n");
      let references: SourceReference[] = selected.map(
        ({ text, location }) => ({
          text,
          location,
          kind: "selection",
        }),
      );
      if (useSection || !context) {
        const sourceLocation = adapter?.getLocation();
        context = (await adapter?.getContext()) || "";
        references = sourceLocation
          ? contextReferences(context.slice(0, 21000), sourceLocation)
          : [];
      }
      if (controller.signal.aborted) return;
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          documentId: doc.id,
          role: "user",
          content: question,
          context: context.slice(0, 21000),
          references,
          attachments,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (!directImage) setPrompt("");
      await chat(
        doc.id,
        provider,
        question,
        context.slice(0, 21000),
        controller.signal,
        (text) => setStream((s) => s + text),
        references,
        attachments.map((image) => image.id),
        (message) => toast.info(message),
      );
      setMessages(await api.messages(doc.id));
      setStream("");
      if (!directImage) {
        setQuotes([]);
        setImages((current) =>
          current.filter(
            (image) => !attachments.some((sent) => sent.id === image.id),
          ),
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
      setMessages(await api.messages(doc.id).catch(() => messages));
      setStream("");
    } finally {
      setSending(false);
      abort.current = null;
    }
  };
  const blockAction = (block: PDFBlock, action: PDFBlockAction) => {
    const image: ImageAttachment = {
      id: block.id,
      page: block.page,
      label: block.label,
      caption: block.caption,
    };
    if (action === "preview") {
      setPreviewImage(image);
      return;
    }
    if (sending) {
      toast.info("请等待当前回答完成");
      return;
    }
    setRight(true);
    setRightTab("ai");
    if (action === "explain") {
      void send(
        "请详细解释这张图表或公式，说明图中信息、符号及其在原文中的含义，区分事实与推断。",
        [],
        false,
        [image],
        true,
      );
      return;
    }
    if (images.some((item) => item.id === image.id)) {
      composeInput.current?.focus();
      return;
    }
    if (images.length >= 4) {
      toast.info("每次最多附加 4 张图片");
      return;
    }
    setImages((current) => [...current, image]);
    requestAnimationFrame(() => composeInput.current?.focus());
  };
  const imageAttachments = (items: ImageAttachment[], removable = false) => (
    <div className="image-attachments">
      {items.map((image) => (
        <div key={image.id} className="image-attachment">
          <Button
            className="attachment-preview"
            variant="ghost"
            aria-label={`查看附件：${imageLabel(image)}`}
            onClick={() => setPreviewImage(image)}
          >
            <img
              src={blockImageURL(doc.id, image.id)}
              alt={imageLabel(image)}
            />
            <span>{imageLabel(image)}</span>
          </Button>
          {removable && (
            <Button
              className="attachment-remove"
              variant="ghost"
              size="icon-xs"
              aria-label={`移除附件：${imageLabel(image)}`}
              onClick={() =>
                setImages((current) =>
                  current.filter((item) => item.id !== image.id),
                )
              }
            >
              <X />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
  const exportNotes = () => {
    const text =
      `# ${doc.title}\n\n` +
      annotations
        .map(
          (a) =>
            `## ${a.kind} · ${locationLabel(a.location)}\n\n${a.quote ? "> " + a.quote.replaceAll("\n", "\n> ") + "\n\n" : ""}${a.note}\n`,
        )
        .join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title.replace(/[/\\:]/g, "-")}-notes.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="workspace">
      <header className="reader-toolbar">
        <div className="reader-title-group">
          <IconButton
            label="返回书库"
            onClick={() => {
              void flushProgress()
                .then(onBack)
                .catch((e) => toast.error(e.message));
            }}
          >
            <ArrowLeft />
          </IconButton>
          <span className="toolbar-divider" />
          <BookOpen className="size-4 text-muted-foreground" />
          <span className="reader-title" title={doc.title}>
            {doc.title}
          </span>
          <Badge variant="secondary">{doc.type.toUpperCase()}</Badge>
        </div>
        <div className="toolbar-actions">
          {returnLocation && (
            <Button
              variant="outline"
              size="sm"
              disabled={referenceBusy}
              onClick={() => void returnFromReference()}
            >
              <ArrowLeft className="size-3" />
              返回阅读位置
            </Button>
          )}
          <div className="page-navigation">
            <IconButton
              label="上一页"
              onClick={() =>
                void adapter?.previous().catch((e) => toast.error(e.message))
              }
            >
              <ChevronLeft />
            </IconButton>
            {doc.type === "pdf" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const page = Number(pageInput);
                  if (Number.isInteger(page) && page > 0)
                    move({ type: "pdf", page });
                }}
              >
                <Input
                  aria-label="跳转 PDF 页码"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  className="h-7 w-14 text-center"
                />
              </form>
            ) : null}
            <IconButton
              label="下一页"
              onClick={() =>
                void adapter?.next().catch((e) => toast.error(e.message))
              }
            >
              <ChevronRight />
            </IconButton>
          </div>
          <span className="toolbar-divider" />
          <IconButton
            label="目录与搜索"
            active={left}
            expanded={left}
            onClick={() => setLeft(!left)}
          >
            <PanelLeft />
          </IconButton>
          <IconButton
            label="添加书签"
            onClick={() => void annotate("bookmark")}
          >
            <BookmarkPlus />
          </IconButton>
          <Popover>
            <PopoverTrigger
              render={
                <Button size="icon-sm" variant="ghost" aria-label="阅读外观" />
              }
            >
              <Type />
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <h3 className="mb-4 text-sm font-medium">阅读外观</h3>
              <div className="space-y-4">
                <div className="flex gap-2">
                  {(["light", "sepia", "dark"] as const).map((mode, i) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={theme.mode === mode ? "default" : "outline"}
                      onClick={() =>
                        setTheme({
                          mode,
                          appearance: mode === "sepia" ? "light" : mode,
                        })
                      }
                    >
                      {["浅色", "纸张", "深色"][i]}
                    </Button>
                  ))}
                </div>
                {doc.type === "epub" ? (
                  <>
                    <div className="setting-row">
                      <span>字号</span>
                      <Button
                        size="icon-xs"
                        variant="outline"
                        onClick={() =>
                          setTheme({
                            fontSize: Math.max(0.8, theme.fontSize - 0.1),
                          })
                        }
                      >
                        −
                      </Button>
                      <span>{Math.round(theme.fontSize * 100)}%</span>
                      <Button
                        size="icon-xs"
                        variant="outline"
                        onClick={() =>
                          setTheme({
                            fontSize: Math.min(2.4, theme.fontSize + 0.1),
                          })
                        }
                      >
                        +
                      </Button>
                    </div>
                    <div className="setting-row">
                      <span>行距</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setTheme({
                            lineHeight:
                              theme.lineHeight >= 2.2
                                ? 1.4
                                : Math.round((theme.lineHeight + 0.2) * 10) /
                                  10,
                          })
                        }
                      >
                        {theme.lineHeight.toFixed(1)}
                      </Button>
                      <span>页边距</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setTheme({
                            margin: theme.margin >= 64 ? 16 : theme.margin + 16,
                          })
                        }
                      >
                        {theme.margin}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setTheme({
                            fontFamily:
                              theme.fontFamily === "serif"
                                ? "sans-serif"
                                : "serif",
                          })
                        }
                      >
                        {theme.fontFamily === "serif"
                          ? "宋体 / 衬线"
                          : "黑体 / 无衬线"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTheme({ scroll: !theme.scroll })}
                      >
                        <AlignJustify />
                        {theme.scroll ? "滚动阅读" : "分页阅读"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    {(["width", 1, 1.25, 1.5] as const).map((zoom) => (
                      <Button
                        key={zoom}
                        size="sm"
                        variant={theme.zoom === zoom ? "default" : "outline"}
                        onClick={() => setTheme({ zoom })}
                      >
                        {zoom === "width" ? "适宽" : `${zoom * 100}%`}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <IconButton
            label="AI 与笔记"
            active={right}
            expanded={right}
            onClick={() => setRight(!right)}
          >
            <PanelRight />
          </IconButton>
          <IconButton label="设置" onClick={onSettings}>
            <Settings2 />
          </IconButton>
        </div>
      </header>
      <ResizablePanelGroup
        orientation="horizontal"
        className="reader-panels"
        elementRef={panelGroup}
        onLayoutChanged={(layout, { isUserInteraction }) => {
          if (isUserInteraction) {
            setLeft(layout.navigation > 0);
            setRight(layout.assistant > 0);
          }
        }}
        onPointerDownCapture={(event) => {
          if (
            (event.target as Element).closest('[data-slot="resizable-handle"]')
          )
            panelGroup.current?.removeAttribute("data-toggling");
        }}
      >
        <ResizablePanel
          id="navigation"
          panelRef={leftPanel}
          collapsible
          collapsedSize={0}
          style={{ overflow: "hidden" }}
          defaultSize="19%"
          minSize="180px"
          maxSize="30%"
        >
          <aside className="reader-sidebar" data-open={left} inert={!left}>
            <Tabs
              value={leftTab}
              onValueChange={(value) => setLeftTab(String(value))}
              className="h-full gap-0"
            >
              <TabsList className="panel-tabs">
                <TabsTrigger value="toc">
                  <ListTree className="size-3.5" />
                  目录
                </TabsTrigger>
                <TabsTrigger value="search">
                  <Search className="size-3.5" />
                  搜索
                </TabsTrigger>
              </TabsList>
              <TabsContent value="toc" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <TOCTree items={toc} go={move} location={location} />
                  {!toc.length && (
                    <p className="p-4 text-xs text-muted-foreground">
                      正在读取目录…
                    </p>
                  )}
                </ScrollArea>
              </TabsContent>
              <TabsContent value="search" className="min-h-0 flex-1 p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void search();
                  }}
                  className="flex gap-1"
                >
                  <Input
                    aria-label="搜索文档"
                    placeholder="搜索文档内容…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <Button
                    size="icon"
                    variant="secondary"
                    disabled={searching}
                    aria-label="搜索"
                  >
                    <Search />
                  </Button>
                </form>
                <p className="my-3 text-xs text-muted-foreground">
                  {searching ? "正在搜索…" : `${results.length} 个结果`}
                </p>
                <ScrollArea className="h-[calc(100%-90px)]">
                  {results.map((result) => (
                    <Button
                      key={result.id}
                      variant="ghost"
                      className="search-result"
                      onClick={() => move(result.location)}
                    >
                      <small>{locationLabel(result.location)}</small>
                      <span>{result.excerpt}</span>
                    </Button>
                  ))}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </aside>
        </ResizablePanel>
        <ResizableHandle
          disabled={!left}
          className={left ? "" : "sidebar-handle-closed"}
        />
        <ResizablePanel id="reading" minSize="30%">
          <div className="reading-pane" ref={readingPane}>
            <ReaderView
              document={doc}
              theme={theme}
              annotations={annotations}
              blocks={blocks}
              onReady={(engine, items) => {
                setAdapter(engine);
                setTOC(items);
              }}
              events={{
                location: saveLocation,
                selection: setSelection,
                blockAction,
              }}
            />
            {selection?.anchor && (
              <SelectionToolbar anchor={selection.anchor} pane={readingPane}>
                <Badge variant="secondary">
                  已选 {selection.text.length} 字
                </Badge>
                <IconButton
                  label="高亮"
                  onClick={() => void annotate("highlight")}
                >
                  <Highlighter />
                </IconButton>
                <IconButton
                  label="下划线"
                  onClick={() => void annotate("underline")}
                >
                  <Underline />
                </IconButton>
                <IconButton
                  label="记笔记"
                  onClick={() => {
                    setNoteSelection(selection);
                    setNote("");
                    setNoteOpen(true);
                    adapter?.clearSelection();
                  }}
                >
                  <StickyNote />
                </IconButton>
                <IconButton
                  label="翻译选区"
                  onClick={() =>
                    void send("请忠实地将这段文字翻译成简体中文。", [selection])
                  }
                >
                  <Languages />
                </IconButton>
                <IconButton
                  label="解释选区"
                  onClick={() =>
                    void send(
                      "请解释这段文字的含义，区分原文结论与你的补充说明。",
                      [selection],
                    )
                  }
                >
                  <Sparkles />
                </IconButton>
                <IconButton label="引用到对话" onClick={addQuote}>
                  <Quote />
                </IconButton>
                <IconButton
                  label="取消选区"
                  onClick={() => {
                    adapter?.clearSelection();
                    setSelection(null);
                  }}
                >
                  <X />
                </IconButton>
              </SelectionToolbar>
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle
          disabled={!right}
          className={right ? "" : "sidebar-handle-closed"}
        />
        <ResizablePanel
          id="assistant"
          panelRef={rightPanel}
          collapsible
          collapsedSize={0}
          style={{ overflow: "hidden" }}
          defaultSize="25%"
          minSize="250px"
          maxSize="45%"
        >
          <aside className="assistant-sidebar" data-open={right} inert={!right}>
            <Tabs
              value={rightTab}
              onValueChange={(value) => setRightTab(String(value))}
              className="h-full gap-0"
            >
              <TabsList className="panel-tabs">
                <TabsTrigger value="ai">
                  <Sparkles className="size-3.5" />
                  AI 助读
                </TabsTrigger>
                <TabsTrigger value="notes">
                  <StickyNote className="size-3.5" />
                  笔记<small>{annotations.length || ""}</small>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="ai" className="ai-panel">
                <ScrollArea className="chat-scroll">
                  <div className="chat-messages">
                    {!messages.length && !sending ? (
                      <div className="chat-empty">
                        <p>
                          选中原文，可以翻译、解释，
                          <br />
                          或引用多段文字一起讨论。
                        </p>
                        <Button
                          variant="outline"
                          className="suggestion"
                          disabled={!adapter}
                          onClick={() =>
                            void send(
                              doc.type === "epub"
                                ? "请总结当前章节的核心内容，并列出值得思考的问题。"
                                : "请总结当前 PDF 页的主要内容，保留重要术语。",
                              [],
                              true,
                            )
                          }
                        >
                          <BookOpen />
                          总结当前{doc.type === "epub" ? "章节" : "页面"}
                          <ArrowLeft className="ml-auto rotate-180" />
                        </Button>
                        <Button
                          variant="outline"
                          className="suggestion"
                          disabled={!adapter}
                          onClick={() =>
                            void send(
                              "请找出当前内容的核心概念，并用简明的语言解释。",
                              [],
                              true,
                            )
                          }
                        >
                          <MessageSquare />
                          解释核心概念
                          <ArrowLeft className="ml-auto rotate-180" />
                        </Button>
                        <p className="privacy-note">
                          对话发送所选文字或当前
                          {doc.type === "epub" ? "章节" : "页面"}给 AI。PDF
                          图表按主 Agent 设置自动预处理。
                        </p>
                      </div>
                    ) : (
                      messages.map((message) => (
                        <div
                          className={`chat-message ${message.role}`}
                          key={message.id}
                        >
                          <span className="message-author">
                            {message.role === "user" ? "你" : "Reader AI"}
                          </span>
                          <div>{message.content}</div>
                          {!!message.attachments?.length &&
                            imageAttachments(message.attachments)}
                          <SourceReferences
                            message={message}
                            toc={toc}
                            adapter={adapter}
                            onNavigate={visitReference}
                          />
                        </div>
                      ))
                    )}
                    {sending && (
                      <div className="chat-message assistant">
                        <span className="message-author">
                          Reader AI <span className="pulse-dot" />
                        </span>
                        <div>{stream || "正在阅读上下文…"}</div>
                      </div>
                    )}
                    <div ref={messageEnd} />
                  </div>
                </ScrollArea>
                <div className="chat-compose">
                  {quotes.length > 0 && (
                    <div className="quote-chips">
                      {quotes.map((q, i) => (
                        <div key={i}>
                          <Quote size={12} />
                          <span>{q.text}</span>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="移除引用"
                            onClick={() =>
                              setQuotes((items) =>
                                items.filter((_, j) => j !== i),
                              )
                            }
                          >
                            <X />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!!images.length && imageAttachments(images, true)}
                  <Textarea
                    ref={composeInput}
                    aria-label="向 AI 提问"
                    placeholder="问一个问题，或引用选中的文字…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="compose-footer">
                    <Select
                      value={provider}
                      onValueChange={(value) => {
                        if (value) setProvider(value);
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="min-w-36 w-auto border-0 shadow-none"
                        aria-label="选择 AI 助手"
                      >
                        <SelectValue>
                          <ProviderIdentity provider={provider} />
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="codex">
                          <ProviderIdentity provider="codex" />
                        </SelectItem>
                        <SelectItem value="claude">
                          <ProviderIdentity provider="claude" />
                        </SelectItem>
                        <SelectItem value="kimi">
                          <ProviderIdentity provider="kimi" />
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {sending ? (
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="停止回答"
                        onClick={() => abort.current?.abort()}
                      >
                        <Square className="size-3" />
                      </Button>
                    ) : (
                      <Button
                        size="icon-sm"
                        aria-label="发送问题"
                        disabled={
                          !adapter || (!prompt.trim() && !images.length)
                        }
                        onClick={() => void send()}
                      >
                        <Send className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="notes" className="notes-panel">
                <div className="notes-heading">
                  <span>{annotations.length} 条记录</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!annotations.length}
                    onClick={exportNotes}
                  >
                    <Download />
                    导出
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="notes-list">
                    {!annotations.length && (
                      <div className="notes-empty">
                        <StickyNote />
                        <p>暂无笔记</p>
                        <small>选中文字添加高亮、下划线或笔记。</small>
                      </div>
                    )}
                    {annotations.map((a) => (
                      <article className="note-card" key={a.id}>
                        <div>
                          <Badge variant="outline">
                            {
                              {
                                highlight: "高亮",
                                underline: "下划线",
                                note: "笔记",
                                bookmark: "书签",
                              }[a.kind]
                            }
                          </Badge>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="删除记录"
                            onClick={() => {
                              void api
                                .removeAnnotation(doc.id, a.id)
                                .then(() =>
                                  setAnnotations((items) =>
                                    items.filter((i) => i.id !== a.id),
                                  ),
                                )
                                .catch((e) => toast.error(e.message));
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          className="note-quote"
                          onClick={() => move(a.location)}
                        >
                          {a.quote || locationLabel(a.location)}
                        </Button>
                        {a.note && <p>{a.note}</p>}
                      </article>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>

      {previewImage && (
        <ImagePreview
          key={previewImage.id}
          documentId={doc.id}
          image={previewImage}
          renderImage={renderBlockImage}
          onClose={() => setPreviewImage(undefined)}
        />
      )}
      <Dialog
        open={noteOpen}
        onOpenChange={(open) => {
          setNoteOpen(open);
          if (!open) setNoteSelection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加笔记</DialogTitle>
            <DialogDescription className="sr-only">
              为当前选区添加笔记
            </DialogDescription>
          </DialogHeader>
          <blockquote className="note-preview">
            {noteSelection?.text}
          </blockquote>
          <Textarea
            autoFocus
            placeholder="笔记内容…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            onClick={() => void annotate("note", note)}
            disabled={!note.trim()}
          >
            <Check />
            保存笔记
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
