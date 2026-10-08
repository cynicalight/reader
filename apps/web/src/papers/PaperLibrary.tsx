import { useEffect, useMemo, useRef } from "react";
import {
  Check,
  CheckSquare,
  FolderMinus,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Search,
  Star,
  StickyNote,
  Highlighter,
  CircleHelp,
  Quote,
  Trash2,
} from "lucide-react";
import type {
  Document,
  PaperSort,
  Processing,
  ReadingStatus,
} from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Checkbox } from "@reader/ui/components/checkbox";
import { Input } from "@reader/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@reader/ui/components/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@reader/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@reader/ui/components/dropdown-menu";
import { useReaderStore } from "../store";
import { TrashView } from "../TrashView";
import { trashWithUndo } from "../library-actions";
import { toast } from "sonner";
import {
  addToCategory,
  createCategory,
  importReference,
  looksLikeReference,
  removeFromCategory,
  savePaperPreferences,
  setReadingStatus,
  setStarred,
} from "./actions";
import { paperByline } from "./format";
import {
  categoryTree,
  filterPapers,
  flattenCategories,
  paperCategories,
  sortLabels,
  statusLabels,
  viewLabels,
  type BuiltinView,
} from "./model";
import { usePaperUI } from "./state";
import { PaperDetail } from "./PaperDetail";
import { PaperMenuItems, type PaperMenuActions } from "./PaperMenu";
import { CategoryDialog } from "./CategoryDialog";
import { CitationDialog } from "./CitationDialog";
import { copyCitations, exportCitations } from "./CitationMenu";
import { PAPER_DRAG_TYPE } from "./PaperSidebar";

export interface PaperLibraryProps {
  documents: Document[];
  trash: Document[];
  jobs: Map<string, Processing>;
  loading: boolean;
  openDocument: (doc: Document) => void;
  moveToBooks: (doc: Document) => void;
  navOpen: boolean;
  onToggleNav: () => void;
}

const busy = (job?: Processing) =>
  !!job && !["complete", "failed"].includes(job.status);

export function PaperLibrary({
  documents,
  trash,
  jobs,
  loading,
  openDocument,
  moveToBooks,
  navOpen,
  onToggleNav,
}: PaperLibraryProps) {
  const prefs = useReaderStore((s) => s.libraryPreferences.papers) || {};
  const sort: PaperSort = prefs.sort || "opened";
  const ui = usePaperUI();
  const { view, query, selectedId, picking, picked, naming, exporting } = ui;
  const listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () =>
      view === "trash"
        ? []
        : filterPapers(
            documents,
            view,
            query,
            sort,
            jobs,
            prefs.subcategoryItems !== false,
          ),
    [documents, view, query, sort, jobs, prefs.subcategoryItems],
  );
  const visibleIds = visible.map((d) => d.id);
  const selected = documents.find((d) => d.id === selectedId);
  const pickedDocs = documents.filter((d) => picked.has(d.id));
  const categories = paperCategories(prefs, documents);
  const category = view.startsWith("tag:") ? view.slice(4) : "";
  const title =
    view === "trash"
      ? "回收站"
      : category.replaceAll("/", " / ") ||
        viewLabels[view as BuiltinView] ||
        "全部论文";
  useEffect(() => {
    // Pasting an arXiv ID, DOI or link anywhere outside a field imports it.
    const paste = (e: ClipboardEvent) => {
      const target = e.target as Element | null;
      if (
        target?.closest?.(
          'input, textarea, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      const text = e.clipboardData?.getData("text/plain")?.trim() || "";
      if (!looksLikeReference(text)) return;
      e.preventDefault();
      const id = toast.loading("正在查找并下载论文…");
      void importReference(text)
        .then((doc) =>
          toast.success(
            doc.library === "papers"
              ? `已导入《${doc.title}》`
              : "这篇论文已在图书库中，可在那里移动",
            { id },
          ),
        )
        .catch((error) => toast.error((error as Error).message, { id }));
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);
  useEffect(() => {
    // ⌘⇧C copies the selected papers in the last used citation format.
    const key = (e: KeyboardEvent) => {
      if (
        !(e.metaKey || e.ctrlKey) ||
        !e.shiftKey ||
        e.key.toLowerCase() !== "c" ||
        (e.target as Element | null)?.closest?.("input, textarea")
      )
        return;
      const state = usePaperUI.getState();
      const all = useReaderStore.getState().documents;
      const targets = state.picking
        ? all.filter((d) => state.picked.has(d.id))
        : all.filter((d) => d.id === state.selectedId);
      if (!targets.length) return;
      e.preventDefault();
      void copyCitations(
        targets,
        useReaderStore.getState().libraryPreferences.papers?.citationStyle ||
          "gb7714",
      );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    // A paper that left the library (trash, move) cannot stay selected.
    if (selectedId && !selected) ui.select(null);
  }, [selectedId, selected, ui]);
  const actions: PaperMenuActions = {
    open: openDocument,
    move: moveToBooks,
    trash: (docs) => {
      void trashWithUndo(docs.map((d) => d.id)).then((result) => {
        const state = usePaperUI.getState();
        state.setPicked(
          [...state.picked].filter((id) => !result.deleted.includes(id)),
        );
      });
    },
    newCategory: (docs) => ui.setNaming(docs.map((d) => d.id)),
  };
  const menuDocs = (doc: Document) =>
    picking && picked.has(doc.id) ? pickedDocs : [doc];
  const allPicked =
    visible.length > 0 && visible.every((d) => picked.has(d.id));
  const focusRow = (id: string) =>
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>(`[data-paper-id="${id}"]`)
        ?.focus(),
    );
  const onListKey = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest("input, textarea, [role=menu]")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      ui.startPicking(visibleIds);
      return;
    }
    if (e.key === "Escape") {
      if (picking) ui.stopPicking();
      else ui.select(null);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const index = visibleIds.indexOf(
        (document.activeElement as HTMLElement)?.dataset.paperId ||
          selectedId ||
          "",
      );
      const next =
        visibleIds[
          Math.max(
            0,
            Math.min(
              visibleIds.length - 1,
              index + (e.key === "ArrowDown" ? 1 : -1),
            ),
          )
        ];
      if (next) {
        if (!picking) ui.select(next);
        focusRow(next);
      }
    }
  };
  return (
    <main className="library-main paper-library">
      <header className="library-topbar">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="切换侧栏"
            aria-expanded={navOpen}
            onClick={onToggleNav}
          >
            <PanelLeft />
          </Button>
          <h1 className="library-title truncate">{title}</h1>
          {view !== "trash" && (
            <span className="text-xs text-muted-foreground">
              {visible.length}
            </span>
          )}
        </div>
        {view !== "trash" && (
          <div className="flex items-center gap-2">
            <div className="search-field paper-search">
              <Search className="size-4" />
              <Input
                aria-label="搜索论文"
                placeholder="标题、作者、出处、DOI、摘要…"
                value={query}
                onChange={(e) => ui.setQuery(e.target.value)}
              />
            </div>
            <Select
              value={sort}
              onValueChange={(value) => {
                if (value)
                  void savePaperPreferences((p) => ({
                    ...p,
                    sort: value as PaperSort,
                  }));
              }}
            >
              <SelectTrigger size="sm" aria-label="排序">
                <SelectValue>{sortLabels[sort]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(sortLabels) as PaperSort[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {sortLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={picking ? "secondary" : "outline"}
              aria-pressed={picking}
              disabled={!visible.length && !picking}
              onClick={() => (picking ? ui.stopPicking() : ui.startPicking())}
            >
              {picking ? <Check /> : <CheckSquare />}
              {picking ? "完成" : "批量"}
            </Button>
          </div>
        )}
      </header>
      {view === "trash" ? (
        <div className="library-content">
          <TrashView documents={trash} />
        </div>
      ) : (
        <div className="paper-library-body">
          <section
            className="paper-list-pane"
            aria-label="论文列表"
            onKeyDown={onListKey}
          >
            {picking && (
              <div
                className="paper-batch-bar"
                role="toolbar"
                aria-label="批量操作"
              >
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={allPicked}
                    indeterminate={picked.size > 0 && !allPicked}
                    onCheckedChange={() =>
                      allPicked
                        ? ui.setPicked(
                            [...picked].filter(
                              (id) => !visibleIds.includes(id),
                            ),
                          )
                        : ui.setPicked([...picked, ...visibleIds])
                    }
                  />
                  全选
                </label>
                <span className="text-sm text-muted-foreground" role="status">
                  已选 {picked.size} 篇
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!pickedDocs.length}
                        />
                      }
                    >
                      <FolderPlus />
                      加入分类
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-80 w-48">
                      {flattenCategories(categoryTree(categories)).map(
                        (node) => (
                          <DropdownMenuItem
                            key={node.name}
                            onClick={() =>
                              void addToCategory(pickedDocs, node.name)
                            }
                          >
                            <span
                              className="truncate"
                              style={{ paddingLeft: node.depth * 12 }}
                            >
                              {node.label}
                            </span>
                          </DropdownMenuItem>
                        ),
                      )}
                      {categories.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onClick={() => actions.newCategory(pickedDocs)}
                      >
                        <FolderPlus />
                        新建分类并放入…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {category && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!pickedDocs.length}
                      onClick={() =>
                        void removeFromCategory(pickedDocs, category)
                      }
                    >
                      <FolderMinus />
                      移出当前分类
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!pickedDocs.length}
                        />
                      }
                    >
                      阅读状态
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {(Object.keys(statusLabels) as ReadingStatus[]).map(
                        (key) => (
                          <DropdownMenuItem
                            key={key}
                            onClick={() =>
                              void setReadingStatus(pickedDocs, key)
                            }
                          >
                            标为{statusLabels[key]}
                          </DropdownMenuItem>
                        ),
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!pickedDocs.length}
                    onClick={() =>
                      void setStarred(
                        pickedDocs,
                        !pickedDocs.every((d) => d.favorite),
                      )
                    }
                  >
                    <Star />
                    星标
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!pickedDocs.length}
                    onClick={() =>
                      exportCitations(pickedDocs, `${pickedDocs.length} 篇论文`)
                    }
                  >
                    <Quote />
                    导出引用
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={!pickedDocs.length}
                    onClick={() => actions.trash(pickedDocs)}
                  >
                    <Trash2 />
                    移到回收站
                  </Button>
                </div>
              </div>
            )}
            {loading ? (
              <div className="empty-state">
                <Loader2 className="animate-spin text-muted-foreground" />
              </div>
            ) : visible.length ? (
              <div className="paper-list" ref={listRef} role="list">
                {visible.map((doc) => (
                  <PaperRow
                    key={doc.id}
                    doc={doc}
                    job={jobs.get(doc.id)}
                    selected={!picking && selectedId === doc.id}
                    picking={picking}
                    picked={picked.has(doc.id)}
                    dragIds={() =>
                      picked.has(doc.id) ? [...picked] : [doc.id]
                    }
                    onActivate={(e) => {
                      if (picking || e.metaKey || e.ctrlKey || e.shiftKey)
                        ui.togglePick(doc.id, e.shiftKey, visibleIds);
                      else ui.select(selectedId === doc.id ? null : doc.id);
                    }}
                    onOpen={() => openDocument(doc)}
                    menu={
                      <PaperMenuItems
                        kind="context"
                        docs={menuDocs(doc)}
                        actions={actions}
                      />
                    }
                    moreMenu={
                      <PaperMenuItems
                        kind="dropdown"
                        docs={menuDocs(doc)}
                        actions={actions}
                      />
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h2>{documents.length ? "没有符合条件的论文" : "暂无论文"}</h2>
                {documents.length > 0 && (query || view !== "all") && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      ui.setQuery("");
                      ui.setView("all");
                    }}
                  >
                    显示全部论文
                  </Button>
                )}
              </div>
            )}
          </section>
          {selected && !picking && (
            <PaperDetail
              key={selected.id}
              doc={selected}
              actions={actions}
              onClose={() => ui.select(null)}
            />
          )}
        </div>
      )}
      {exporting && (
        <CitationDialog
          docs={documents.filter((d) => exporting.ids.includes(d.id))}
          title={exporting.title}
          onClose={() => ui.setExporting(null)}
          onEdit={(doc) => {
            ui.setExporting(null);
            ui.stopPicking();
            ui.setView("all");
            ui.setQuery("");
            ui.select(doc.id);
          }}
        />
      )}
      {naming && (
        <CategoryDialog
          count={naming.length}
          parent={ui.namingParent}
          onClose={() => ui.setNaming(null)}
          onSave={(name) =>
            createCategory(
              name,
              documents.filter((d) => naming.includes(d.id)),
              ui.namingParent,
            )
          }
        />
      )}
    </main>
  );
}

function PaperRow({
  doc,
  job,
  selected,
  picking,
  picked,
  dragIds,
  onActivate,
  onOpen,
  menu,
  moreMenu,
}: {
  doc: Document;
  job?: Processing;
  selected: boolean;
  picking: boolean;
  picked: boolean;
  dragIds: () => string[];
  onActivate: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onOpen: () => void;
  menu: React.ReactNode;
  moreMenu: React.ReactNode;
}) {
  const byline = paperByline(doc);
  const percent = Math.round(doc.percentage * 100);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<article />}
        role="listitem"
        className="paper-row"
        data-paper-id={doc.id}
        data-selected={selected || undefined}
        data-picked={picked || undefined}
        tabIndex={0}
        draggable
        aria-label={doc.title}
        onDragStart={(e) => {
          e.dataTransfer.setData(PAPER_DRAG_TYPE, JSON.stringify(dragIds()));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={(e) => {
          if ((e.target as Element).closest("[data-row-action]")) return;
          onActivate(e);
        }}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("[data-row-action]")) return;
          if (!picking) onOpen();
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") {
            e.preventDefault();
            if (picking) onActivate(e);
            else onOpen();
          }
          if (e.key === " ") {
            e.preventDefault();
            onActivate(e);
          }
        }}
      >
        {picking && (
          <span className="paper-row-check" data-row-action>
            <Checkbox
              checked={picked}
              aria-label={`选择 ${doc.title}`}
              onCheckedChange={() => onActivate({} as React.MouseEvent)}
            />
          </span>
        )}
        <div className="paper-row-main">
          <p className="paper-row-title" title={doc.title}>
            {doc.favorite && (
              <Star className="mr-1 inline size-3 fill-current text-amber-500" />
            )}
            {doc.title}
          </p>
          {byline && (
            <p className="paper-row-byline" title={byline}>
              {byline}
            </p>
          )}
        </div>
        <div className="paper-row-meta">
          {busy(job) && (
            <span className="paper-row-job" title={job!.detail}>
              <Loader2 className="size-3 animate-spin" />
              解析中
            </span>
          )}
          {doc.noteCount > 0 && (
            <span title={`${doc.noteCount} 条笔记`}>
              <StickyNote className="size-3" />
              {doc.noteCount}
            </span>
          )}
          {doc.openQuestionCount > 0 && (
            <span title={`${doc.openQuestionCount} 个问题待回答`}>
              <CircleHelp className="size-3" />
              {doc.openQuestionCount}
            </span>
          )}
          {doc.highlightCount > 0 && (
            <span title={`${doc.highlightCount} 处划线`}>
              <Highlighter className="size-3" />
              {doc.highlightCount}
            </span>
          )}
          <span className="paper-row-status" data-status={doc.readingStatus}>
            {doc.readingStatus === "reading" && percent > 0
              ? `${percent}%`
              : statusLabels[doc.readingStatus]}
          </span>
        </div>
        <span data-row-action>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="paper-row-more"
                  aria-label={`${doc.title} 的更多操作`}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {moreMenu}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}
