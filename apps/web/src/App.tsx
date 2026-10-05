import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Library,
  Star,
  Plus,
  Search,
  Settings2,
  ArrowUpRight,
  FileText,
  Loader2,
  PanelLeft,
  Command,
  X,
  Tags,
  Pencil,
  Check,
} from "lucide-react";
import { api } from "@reader/api";
import type { Document } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import { TooltipProvider } from "@reader/ui/components/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";
import { Toaster, toast } from "sonner";
import { useReaderStore, refreshLibrary } from "./store";
import { Settings } from "./Settings";
import { Workspace } from "./Workspace";
import { useProcessing } from "./ProcessingStatus";
import { useResolvedTheme } from "./appearance";
import { flushProgress } from "./progress";
import { DocumentEditor, LibraryFilterBar } from "./DocumentManagement";
import { TagBoards } from "./TagBoards";
import { LibraryDocuments } from "./LibraryDocuments";
import { filterDocuments, initialFilters } from "./library";
export function App() {
  const { documents, active, theme, setTheme, open } = useReaderStore();
  const resolvedTheme = useResolvedTheme(theme);
  const { jobs, error: processingError } = useProcessing();
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState("all");
  const [filters, setFilters] = useState(initialFilters);
  const [libraryView, setLibraryView] = useState<"grid" | "list">("grid");
  const [editingLibrary, setEditingLibrary] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [command, setCommand] = useState(false);
  const [nav, setNav] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);
  useEffect(() => {
    Promise.all([
      refreshLibrary(),
      api.settings().then((value) => setTheme(value)),
    ])
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        hydrated.current = true;
      });
  }, [setTheme]);
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      void api.saveSettings(theme).catch((e) => toast.error(e.message));
    }, 350);
    return () => clearTimeout(timer);
  }, [theme]);
  useEffect(() => {
    const dark = resolvedTheme.mode === "dark";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = resolvedTheme.mode;
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    void window.readerDesktop
      ?.setAppearance(theme.appearance ?? "system")
      .catch((e) => toast.error(e.message));
  }, [resolvedTheme.mode, theme.appearance]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        chooseFiles();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(
    () =>
      window.readerDesktop?.onBeforeClose(async () => {
        await flushProgress();
        await api.saveSettings(useReaderStore.getState().theme);
      }),
    [],
  );
  useEffect(() => {
    const flush = () => {
      void flushProgress().catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
  const chooseFiles = () => {
    if (window.readerDesktop) {
      setBusy(true);
      void window.readerDesktop
        .importFiles()
        .catch((e) => toast.error(e.message))
        .finally(() => setBusy(false));
    } else fileRef.current?.click();
  };
  useEffect(
    () =>
      window.readerDesktop?.onLibraryChanged(() => {
        void refreshLibrary().catch((e) => toast.error(e.message));
      }),
    [],
  );
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) await api.import(file);
      await refreshLibrary();
      toast.success(`已导入 ${files.length} 个文件`);
      setError("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sample = async () => {
    setBusy(true);
    try {
      for (const name of ["the-art-of-reading.epub", "reading-notes.pdf"]) {
        const response = await fetch(`/samples/${name}`);
        if (!response.ok) throw new Error("示例文件不可用");
        await api.import(new File([await response.blob()], name));
      }
      await refreshLibrary();
      toast.success("已添加两份示例，可随时开始阅读");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openDocument = (doc: Document) => {
    setEditingLibrary(false);
    open(doc);
    void api.update(doc.id, {}).catch((e) => toast.error(e.message));
  };
  const filtered = filterDocuments(documents, filter, query, filters);
  const editing = documents.find((d) => d.id === editingId);
  const awaitingClassification = documents.some(
    (d) =>
      d.classificationStatus === "pending" ||
      d.classificationStatus === "running",
  );
  useEffect(() => {
    if (!awaitingClassification) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refreshLibrary();
      } catch {
        /* Keep the last available library during a transient disconnect. */
      }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [awaitingClassification]);
  const favorite = async (doc: Document) => {
    try {
      await api.update(doc.id, { favorite: !doc.favorite });
      await refreshLibrary();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <TooltipProvider>
      <div
        className="app"
        data-platform={window.readerDesktop?.platform}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          void importFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <input
          type="file"
          ref={fileRef}
          hidden
          multiple
          accept=".pdf,.epub"
          onChange={(e) => {
            void importFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        {active ? (
          <Workspace
            key={active.id}
            document={active}
            theme={resolvedTheme}
            processing={jobs.find((job) => job.documentId === active.id)}
            onBack={() => {
              open(null);
              void refreshLibrary();
            }}
            onSettings={() => setSettings(true)}
          />
        ) : (
          <>
            <aside
              className={`library-sidebar ${nav ? "" : "collapsed"}`}
              inert={!nav}
            >
              <div className="window-drag-handle" aria-hidden="true" />
              <Button
                className="w-full justify-between"
                variant="outline"
                onClick={() => setCommand(true)}
              >
                <span className="flex items-center gap-2">
                  <Search className="size-3.5" />
                  快速查找
                </span>
                <kbd>⌘ K</kbd>
              </Button>
              <nav className="space-y-1">
                {[
                  {
                    id: "all",
                    label: "全部文档",
                    icon: Library,
                    count: documents.length,
                  },
                  {
                    id: "tags",
                    label: "标签看板",
                    icon: Tags,
                    count: undefined,
                  },
                  {
                    id: "favorites",
                    label: "收藏",
                    icon: Star,
                    count: documents.filter((d) => d.favorite).length,
                  },
                ].map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    className={`nav-item ${filter === item.id ? "active" : ""}`}
                    onClick={() => {
                      setFilter(item.id);
                      setEditingLibrary(false);
                    }}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                    <span className="nav-count">{item.count}</span>
                  </Button>
                ))}
                <Button
                  className="h-[39px] w-full justify-start gap-3 px-3"
                  onClick={chooseFiles}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  <span>{busy ? "导入中…" : "导入文档"}</span>
                </Button>
              </nav>
              <div className="sidebar-bottom">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 />
                  设置
                </Button>
              </div>
            </aside>
            <main className="library-main">
              <header className="library-topbar">
                <div className="flex items-center gap-3">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="切换侧栏"
                    aria-expanded={nav}
                    onClick={() => setNav(!nav)}
                  >
                    <PanelLeft />
                  </Button>
                  <h1 className="library-title">
                    {filter === "tags"
                      ? "标签看板"
                      : filter === "favorites"
                        ? "收藏"
                        : "全部文档"}
                  </h1>
                </div>
                {filter === "tags" ? (
                  <div className="search-field">
                    <Search className="size-4" />
                    <Input
                      aria-label="搜索书库"
                      placeholder="搜索标题、作者、标签…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                ) : (
                  <Button
                    variant={editingLibrary ? "secondary" : "outline"}
                    aria-pressed={editingLibrary}
                    disabled={!filtered.length && !editingLibrary}
                    onClick={() => setEditingLibrary(!editingLibrary)}
                  >
                    {editingLibrary ? <Check /> : <Pencil />}
                    {editingLibrary ? "完成" : "编辑"}
                  </Button>
                )}
              </header>
              <div className="library-content">
                {filter !== "tags" && (
                  <div className="library-controls">
                    <div className="search-field">
                      <Search className="size-4" />
                      <Input
                        aria-label="搜索书库"
                        placeholder="搜索标题、作者、标签…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {filter !== "tags" && (
                  <LibraryFilterBar
                    documents={documents}
                    filters={filters}
                    onChange={setFilters}
                    view={libraryView}
                    onViewChange={setLibraryView}
                    count={filtered.length}
                  />
                )}
                {processingError && (
                  <p className="processing-warning" role="status">
                    解析进度暂时不可用：{processingError}
                  </p>
                )}
                {error ? (
                  <div className="empty-state">
                    <h2>暂时无法连接本地书库</h2>
                    <p>{error}</p>
                    <Button variant="outline" onClick={() => location.reload()}>
                      重新连接
                    </Button>
                  </div>
                ) : loading ? (
                  <div className="empty-state">
                    <Loader2 className="animate-spin text-muted-foreground" />
                    <p>正在打开本地书库</p>
                  </div>
                ) : filter === "tags" ? (
                  <TagBoards
                    documents={documents}
                    query={query}
                    jobs={jobs}
                    processingError={processingError}
                    openDocument={openDocument}
                    favorite={favorite}
                    onEdit={setEditingId}
                    onSettings={() => setSettings(true)}
                  />
                ) : filtered.length ? (
                  <LibraryDocuments
                    key={JSON.stringify([filter, query, filters])}
                    documents={filtered}
                    libraryView={libraryView}
                    editing={editingLibrary}
                    onEditingChange={setEditingLibrary}
                    jobs={jobs}
                    processingError={processingError}
                    openDocument={openDocument}
                    favorite={favorite}
                    onEdit={setEditingId}
                    onSettings={() => setSettings(true)}
                  />
                ) : (
                  <div className="empty-state">
                    <div className="empty-books">
                      <span>
                        <FileText />
                      </span>
                      <span>
                        <BookOpen />
                      </span>
                    </div>
                    <h2>
                      {documents.length
                        ? "没有符合筛选条件的文档"
                        : filter === "favorites"
                          ? "暂无收藏"
                          : "暂无文档"}
                    </h2>
                    {!!documents.length && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setFilters(initialFilters);
                          setQuery("");
                          setFilter("all");
                        }}
                      >
                        显示全部文档
                      </Button>
                    )}
                    {!documents.length && (
                      <Button
                        variant="link"
                        onClick={() => void sample()}
                        disabled={busy}
                      >
                        先体验示例文档 <ArrowUpRight className="size-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </main>
          </>
        )}
        {editing && (
          <DocumentEditor
            key={editing.id}
            document={editing}
            documents={documents}
            onClose={() => setEditingId(null)}
          />
        )}
        <Settings open={settings} onOpenChange={setSettings} />
        <Dialog open={command} onOpenChange={setCommand}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Command size={18} />
                快速查找
              </DialogTitle>
              <DialogDescription>搜索书库，或打开常用操作。</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              placeholder="输入文档标题…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="min-w-0 max-h-72 space-y-1 overflow-auto">
              {filtered.map((d) => (
                <Button
                  key={d.id}
                  variant="ghost"
                  className="min-w-0 w-full justify-start"
                  title={d.title}
                  onClick={() => {
                    openDocument(d);
                    setCommand(false);
                  }}
                >
                  <BookOpen />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {d.title}
                  </span>
                </Button>
              ))}
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setCommand(false);
                  setSettings(true);
                }}
              >
                <Settings2 />
                打开设置
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Toaster
          richColors
          position="bottom-right"
          theme={resolvedTheme.mode === "dark" ? "dark" : "light"}
        />
      </div>
    </TooltipProvider>
  );
}
