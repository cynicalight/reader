import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Library,
  Clock3,
  Star,
  Plus,
  Search,
  Settings2,
  ArrowUpRight,
  FileText,
  ArrowDownToLine,
  Loader2,
  PanelLeft,
  Command,
  HardDrive,
  X,
} from "lucide-react";
import { api } from "@reader/api";
import type { Document } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import { Badge } from "@reader/ui/components/badge";
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
import { flushProgress } from "./progress";
export function App() {
  const { documents, active, theme, setTheme, open } = useReaderStore();
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState("all");
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
    document.documentElement.classList.toggle("dark", theme.mode === "dark");
    document.documentElement.dataset.theme = theme.mode;
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      void api.saveSettings(theme).catch((e) => toast.error(e.message));
    }, 350);
    return () => clearTimeout(timer);
  }, [theme]);
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
    if (window.readerDesktop)
      void window.readerDesktop
        .importFiles()
        .catch((e) => toast.error(e.message));
    else fileRef.current?.click();
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
    open(doc);
    void api.update(doc.id, {}).catch((e) => toast.error(e.message));
  };
  const filtered = documents.filter(
    (d) =>
      (filter !== "recent" || d.percentage > 0) &&
      (filter !== "favorites" || d.favorite) &&
      (d.title + " " + d.author).toLowerCase().includes(query.toLowerCase()),
  );
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
            onBack={() => {
              open(null);
              void refreshLibrary();
            }}
            onSettings={() => setSettings(true)}
          />
        ) : (
          <>
            <aside className={`library-sidebar ${nav ? "" : "collapsed"}`}>
              <div className="brand">
                <span className="brand-icon">
                  <BookOpen size={19} />
                </span>
                <span>
                  Reader<span className="brand-dot">.</span>
                </span>
              </div>
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
              <div className="nav-label">我的阅读空间</div>
              <nav className="space-y-1">
                {[
                  {
                    id: "all",
                    label: "全部文档",
                    icon: Library,
                    count: documents.length,
                  },
                  {
                    id: "recent",
                    label: "最近阅读",
                    icon: Clock3,
                    count: documents.filter((d) => d.percentage > 0).length,
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
                    onClick={() => setFilter(item.id)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                    <span className="nav-count">{item.count}</span>
                  </Button>
                ))}
              </nav>
              <div className="sidebar-bottom">
                <div className="local-note">
                  <HardDrive size={16} />
                  <div>
                    <strong>保存在本地</strong>
                    <p>文档与笔记，由你掌握</p>
                  </div>
                  <span className="status-dot" />
                </div>
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
                    onClick={() => setNav(!nav)}
                  >
                    <PanelLeft />
                  </Button>
                  <span className="text-muted-foreground">阅读空间</span>
                  <span className="text-border">/</span>
                  <span>
                    {filter === "favorites"
                      ? "收藏"
                      : filter === "recent"
                        ? "最近阅读"
                        : "书库"}
                  </span>
                </div>
                <Badge variant="outline" className="gap-2">
                  <span className="status-dot" />
                  Local first
                </Badge>
              </header>
              <div className="library-content">
                <div className="library-heading">
                  <div>
                    <div className="eyebrow">YOUR PERSONAL LIBRARY</div>
                    <h1>
                      {filter === "favorites"
                        ? "值得再读"
                        : filter === "recent"
                          ? "继续上次的阅读"
                          : "留一点时间，给阅读。"}
                    </h1>
                    <p>一本书，一篇论文。让理解多一点，让干扰少一点。</p>
                  </div>
                  <Button onClick={() => chooseFiles()} disabled={busy}>
                    <Plus />
                    {busy ? "正在导入…" : "导入文档"}
                  </Button>
                </div>
                <div className="library-controls">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">
                      {filter === "favorites" ? "收藏文档" : "我的文档"}
                    </span>
                    <Badge variant="secondary">{filtered.length}</Badge>
                  </div>
                  <div className="search-field">
                    <Search className="size-4" />
                    <Input
                      aria-label="搜索书库"
                      placeholder="搜索标题、作者…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
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
                ) : filtered.length ? (
                  <div className="book-grid">
                    {filtered
                      .filter((d) => filter !== "recent" || d.percentage > 0)
                      .map((doc, i) => (
                        <article className="book-card" key={doc.id}>
                          <Button
                            variant="ghost"
                            className={`book-cover cover-${i % 4}`}
                            onClick={() => openDocument(doc)}
                          >
                            <div className="cover-top">
                              <span>READER / {doc.type.toUpperCase()}</span>
                              {doc.type === "epub" ? (
                                <BookOpen size={18} />
                              ) : (
                                <FileText size={18} />
                              )}
                            </div>
                            <div className="cover-title">{doc.title}</div>
                            <div className="cover-bottom">
                              <span>{doc.author || "本地文档"}</span>
                              <ArrowUpRight size={18} />
                            </div>
                            <div className="cover-decoration" />
                          </Button>
                          <div className="book-meta">
                            <Button
                              className="book-title"
                              variant="ghost"
                              onClick={() => openDocument(doc)}
                            >
                              {doc.title}
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={
                                doc.favorite ? "取消收藏" : "收藏文档"
                              }
                              onClick={() => void favorite(doc)}
                            >
                              <Star
                                className={
                                  doc.favorite
                                    ? "fill-current text-amber-500"
                                    : ""
                                }
                              />
                            </Button>
                          </div>
                          <p className="book-author">
                            {doc.author || "作者未提供"}
                            <span>{doc.type.toUpperCase()}</span>
                          </p>
                          <div className="book-progress">
                            <div
                              style={{
                                width: `${Math.round(doc.percentage * 100)}%`,
                              }}
                            />
                          </div>
                          <p className="book-status">
                            {doc.percentage > 0
                              ? `已读 ${Math.round(doc.percentage * 100)}%`
                              : "还未开始阅读"}
                            <span>
                              {(doc.size / 1024 / 1024).toFixed(1)} MB
                            </span>
                          </p>
                        </article>
                      ))}
                    <Button
                      variant="ghost"
                      className="add-card"
                      onClick={() => chooseFiles()}
                    >
                      <span className="add-circle">
                        <Plus />
                      </span>
                      <span>添加下一本书</span>
                      <small>EPUB 或 PDF</small>
                    </Button>
                  </div>
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
                      {query
                        ? "没有找到匹配的文档"
                        : filter === "favorites"
                          ? "把喜欢的文档收藏在这里"
                          : "从你想读的内容开始"}
                    </h2>
                    <p>
                      将 EPUB 电子书或 PDF 论文拖到这里，
                      <br />
                      目录、阅读进度与笔记会陪你一起保存。
                    </p>
                    <Button onClick={() => chooseFiles()} disabled={busy}>
                      <ArrowDownToLine className="size-4" />
                      选择本地文件
                    </Button>
                    {!documents.length && (
                      <Button
                        variant="link"
                        onClick={() => void sample()}
                        disabled={busy}
                      >
                        先体验示例文档 <ArrowUpRight className="size-3" />
                      </Button>
                    )}
                    <div className="empty-features">
                      <span>EPUB + PDF</span>
                      <span>自动保存进度</span>
                      <span>AI 辅助理解</span>
                    </div>
                  </div>
                )}
                <footer className="library-footer">
                  <BookOpen size={14} />
                  <span>阅读是你的节奏，Reader 记得你停下的位置。</span>
                  <span className="ml-auto">⌘ O 导入文档</span>
                </footer>
              </div>
            </main>
          </>
        )}
        {busy && (
          <div className="import-status">
            <Loader2 className="size-4 animate-spin" />
            正在整理文档…
          </div>
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
            <div className="max-h-72 space-y-1 overflow-auto">
              {filtered.map((d) => (
                <Button
                  key={d.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    openDocument(d);
                    setCommand(false);
                  }}
                >
                  <BookOpen />
                  {d.title}
                </Button>
              ))}
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setCommand(false);
                  chooseFiles();
                }}
              >
                <Plus />
                导入文档
              </Button>
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
          theme={theme.mode === "dark" ? "dark" : "light"}
        />
      </div>
    </TooltipProvider>
  );
}
