import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Eye,
  FileText,
  Folder,
  Library,
  Loader2,
  Pin,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import type { Document, Processing, ReadingStatus } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@reader/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@reader/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@reader/ui/components/alert-dialog";
import { useReaderStore } from "../store";
import {
  addToCategory,
  deleteCategory,
  renameCategory,
  savePaperPreferences,
  setReadingStatus,
  setStarred,
} from "./actions";
import { shortTitle } from "./format";
import {
  managedViews,
  matchesView,
  moveCategory,
  paperCategories,
  recentPapers,
  setHidden,
  togglePinned,
  viewLabels,
  type BuiltinView,
  type PaperView,
} from "./model";
import { usePaperUI } from "./state";
import { exportCitations } from "./CitationMenu";

/** Drag payload for papers moved onto sidebar targets. */
export const PAPER_DRAG_TYPE = "application/x-reader-papers";

const viewIcons: Record<BuiltinView, typeof Library> = {
  all: Library,
  reading: BookOpen,
  unread: Circle,
  done: CheckCircle2,
  starred: Star,
  processing: Loader2,
};

function droppedIds(e: React.DragEvent) {
  try {
    const ids: unknown = JSON.parse(e.dataTransfer.getData(PAPER_DRAG_TYPE));
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function SidebarRow({
  icon: Icon,
  label,
  count,
  active,
  pinned,
  onSelect,
  onDrop,
  menu,
  title,
}: {
  icon: typeof Library;
  label: string;
  count?: number;
  active?: boolean;
  pinned?: boolean;
  onSelect: () => void;
  onDrop?: (ids: string[]) => void;
  menu?: React.ReactNode;
  title?: string;
}) {
  const [over, setOver] = useState(false);
  const row = (
    <Button
      variant="ghost"
      className={`nav-item paper-nav-item ${active ? "active" : ""}`}
      data-drop-over={over || undefined}
      title={title || label}
      onClick={onSelect}
      onDragOver={
        onDrop
          ? (e) => {
              if (!e.dataTransfer.types.includes(PAPER_DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setOver(true);
            }
          : undefined
      }
      onDragLeave={() => setOver(false)}
      onDrop={
        onDrop
          ? (e) => {
              const ids = droppedIds(e);
              setOver(false);
              if (!ids.length) return;
              e.preventDefault();
              e.stopPropagation();
              onDrop(ids);
            }
          : undefined
      }
    >
      <Icon className="size-4" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {pinned && <Pin className="size-3 text-muted-foreground" />}
      {count !== undefined && <span className="nav-count">{count}</span>}
    </Button>
  );
  if (!menu) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className="w-48">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

export function PaperSidebar({
  documents,
  jobs,
  trashCount,
  openDocument,
  onNewCategory,
}: {
  documents: Document[];
  jobs: Map<string, Processing>;
  trashCount: number;
  openDocument: (doc: Document) => void;
  onNewCategory: () => void;
}) {
  const prefs = useReaderStore((s) => s.libraryPreferences.papers) || {};
  const { view, setView, select, startPicking } = usePaperUI();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const pinned = prefs.pinned || [];
  const hidden = prefs.hidden || [];
  const categories = paperCategories(prefs, documents);
  const count = (v: PaperView) =>
    documents.filter((d) => matchesView(d, v, jobs)).length;
  const byId = new Map(documents.map((d) => [d.id, d]));
  const docsFor = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((d): d is Document => !!d);
  const choose = (next: PaperView) => {
    setView(next);
    select(null);
  };
  const pinItem = (key: string) => (
    <ContextMenuItem
      onClick={() => void savePaperPreferences((p) => togglePinned(p, key))}
    >
      <Pin />
      {pinned.includes(key) ? "取消置顶" : "置顶"}
    </ContextMenuItem>
  );
  const hideItem = (key: string) => (
    <ContextMenuItem
      onClick={() => {
        void savePaperPreferences((p) => setHidden(p, key, true));
        if (view === key.replace(/^view:/, "")) choose("all");
      }}
    >
      <Eye />
      在侧栏隐藏
    </ContextMenuItem>
  );
  const viewRow = (v: BuiltinView, isPinned = false) => (
    <SidebarRow
      key={`view:${v}`}
      icon={viewIcons[v]}
      label={viewLabels[v]}
      count={count(v)}
      active={view === v}
      pinned={isPinned}
      onSelect={() => choose(v)}
      onDrop={
        v === "starred"
          ? (ids) => void setStarred(docsFor(ids), true)
          : v === "reading" || v === "unread" || v === "done"
            ? (ids) => void setReadingStatus(docsFor(ids), v as ReadingStatus)
            : undefined
      }
      menu={
        managedViews.includes(v) ? (
          <>
            {pinItem(`view:${v}`)}
            {!isPinned && hideItem(`view:${v}`)}
          </>
        ) : undefined
      }
    />
  );
  const categoryRow = (name: string, isPinned = false) => {
    if (renaming === name && !isPinned)
      return (
        <form
          key={`tag:${name}`}
          className="paper-nav-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("name");
            void renameCategory(name, String(value)).then((ok) => {
              if (ok) setRenaming(null);
            });
          }}
        >
          <Folder className="size-4" />
          <Input
            name="name"
            autoFocus
            maxLength={40}
            aria-label="分类名"
            defaultValue={name}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() === name) setRenaming(null);
            }}
          />
        </form>
      );
    const index = categories.indexOf(name);
    const key = `tag:${name}` as const;
    return (
      <SidebarRow
        key={key}
        icon={Folder}
        label={name}
        count={count(`tag:${name}`)}
        active={view === key}
        pinned={isPinned}
        onSelect={() => choose(key)}
        onDrop={(ids) => void addToCategory(docsFor(ids), name)}
        menu={
          <>
            {pinItem(key)}
            <ContextMenuItem onClick={() => setRenaming(name)}>
              改名
            </ContextMenuItem>
            <ContextMenuItem
              disabled={index <= 0}
              onClick={() =>
                void savePaperPreferences((p) => ({
                  ...p,
                  categories: moveCategory(categories, name, -1),
                }))
              }
            >
              上移
            </ContextMenuItem>
            <ContextMenuItem
              disabled={index < 0 || index >= categories.length - 1}
              onClick={() =>
                void savePaperPreferences((p) => ({
                  ...p,
                  categories: moveCategory(categories, name, 1),
                }))
              }
            >
              下移
            </ContextMenuItem>
            {!isPinned && hideItem(key)}
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => {
                choose(key);
                startPicking(
                  documents
                    .filter((d) => matchesView(d, key, jobs))
                    .map((d) => d.id),
                );
              }}
            >
              批量选择这个分类的论文
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                exportCitations(
                  documents.filter((d) => matchesView(d, key, jobs)),
                  name,
                )
              }
            >
              导出这个分类的引用
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              onClick={() => setDeleting(name)}
            >
              <Trash2 />
              删除分类
            </ContextMenuItem>
          </>
        }
      />
    );
  };
  const paperRow = (doc: Document, isPinned = false) => (
    <SidebarRow
      key={`doc:${doc.id}`}
      icon={FileText}
      label={shortTitle(doc)}
      title={doc.title}
      pinned={isPinned}
      onSelect={() => openDocument(doc)}
      menu={
        <>
          <ContextMenuItem onClick={() => openDocument(doc)}>
            <BookOpen />
            打开阅读
          </ContextMenuItem>
          {pinItem(`doc:${doc.id}`)}
          <ContextMenuItem
            onClick={() => {
              choose("all");
              select(doc.id);
            }}
          >
            查看详情
          </ContextMenuItem>
        </>
      }
    />
  );
  const pinnedRows = pinned
    .map((key) => {
      if (key.startsWith("doc:")) {
        const doc = byId.get(key.slice(4));
        return doc ? paperRow(doc, true) : null;
      }
      if (key.startsWith("tag:"))
        return categories.includes(key.slice(4))
          ? categoryRow(key.slice(4), true)
          : null;
      const v = key.slice(5) as BuiltinView;
      return managedViews.includes(v) ? viewRow(v, true) : null;
    })
    .filter(Boolean);
  const recent = recentPapers(documents, pinned, recentOpen ? 10 : 5);
  const recentTotal = recentPapers(documents, pinned, 10).length;
  const hiddenItems = hidden.filter((key) =>
    key.startsWith("tag:")
      ? categories.includes(key.slice(4))
      : managedViews.includes(key.slice(5) as BuiltinView),
  );
  return (
    <div className="paper-sidebar">
      <nav className="space-y-1" aria-label="文献库">
        {viewRow("all")}
      </nav>
      {pinnedRows.length > 0 && (
        <section>
          <h3 className="paper-nav-heading">置顶</h3>
          <nav className="space-y-0.5">{pinnedRows}</nav>
        </section>
      )}
      <section>
        <h3 className="paper-nav-heading">阅读</h3>
        <nav className="space-y-0.5">
          {managedViews
            .filter(
              (v) =>
                !hidden.includes(`view:${v}`) && !pinned.includes(`view:${v}`),
            )
            .map((v) => viewRow(v))}
          {count("processing") > 0 && viewRow("processing")}
        </nav>
      </section>
      <section>
        <h3 className="paper-nav-heading">
          分类
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="新建分类"
            onClick={onNewCategory}
          >
            <Plus />
          </Button>
        </h3>
        <nav className="space-y-0.5">
          {categories
            .filter(
              (name) =>
                !hidden.includes(`tag:${name}`) &&
                !pinned.includes(`tag:${name}`),
            )
            .map((name) => categoryRow(name))}
          {!categories.length && (
            <Button
              variant="ghost"
              className="nav-item paper-nav-item text-muted-foreground"
              onClick={onNewCategory}
            >
              <Plus className="size-4" />
              新建分类
            </Button>
          )}
        </nav>
        {hiddenItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="mt-1 text-muted-foreground"
                />
              }
            >
              已隐藏 {hiddenItems.length} 项
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {hiddenItems.map((key) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() =>
                    void savePaperPreferences((p) => setHidden(p, key, false))
                  }
                >
                  <Eye />
                  显示“
                  {key.startsWith("tag:")
                    ? key.slice(4)
                    : viewLabels[key.slice(5) as BuiltinView]}
                  ”
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </section>
      {recent.length > 0 && (
        <section>
          <h3 className="paper-nav-heading">最近阅读</h3>
          <nav className="space-y-0.5">
            {recent.map((doc) => paperRow(doc))}
            {recentTotal > 5 && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => setRecentOpen(!recentOpen)}
              >
                {recentOpen ? "收起" : `展开更多（${recentTotal - 5}）`}
              </Button>
            )}
          </nav>
        </section>
      )}
      {(trashCount > 0 || view === "trash") && (
        <nav>
          <SidebarRow
            icon={Trash2}
            label="回收站"
            count={trashCount}
            active={view === "trash"}
            onSelect={() => choose("trash")}
          />
        </nav>
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分类“{deleting}”？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && count(`tag:${deleting}`)
                ? `其中 ${count(`tag:${deleting}`)} 篇论文不会被删除，只是不再属于这个分类。`
                : "分类中没有论文。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void deleteCategory(deleting);
                setDeleting(null);
              }}
            >
              删除分类
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
