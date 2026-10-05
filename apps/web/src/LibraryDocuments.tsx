import { useRef, useState } from "react";
import {
  BookOpen,
  FileText,
  ArrowUpRight,
  Star,
  Pencil,
  Trash2,
  ListChecks,
} from "lucide-react";
import type { Document, Processing } from "@reader/core";
import { api } from "@reader/api";
import { toast } from "sonner";
import { Button } from "@reader/ui/components/button";
import { Checkbox } from "@reader/ui/components/checkbox";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@reader/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";
import { DocumentBadges } from "./DocumentManagement";
import { CoverProcessing } from "./ProcessingStatus";
import {
  removeLibraryDocuments,
  toggleDocumentSelection,
} from "./library-actions";

export function LibraryDocuments({
  documents,
  libraryView,
  jobs,
  processingError,
  openDocument,
  favorite,
  onEdit,
  onSettings,
}: {
  documents: Document[];
  libraryView: "grid" | "list";
  jobs: Processing[];
  processingError: string;
  openDocument: (doc: Document) => void;
  favorite: (doc: Document) => void;
  onEdit: (id: string) => void;
  onSettings: () => void;
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState(false);
  const [removing, setRemoving] = useState<Document[]>([]);
  const [deleting, setDeleting] = useState(false);
  const pending = useRef(false);
  const anchor = useRef<string | null>(null);
  const selected = new Set(
    documents.filter((d) => selection.has(d.id)).map((d) => d.id),
  );
  const selecting = mode || selected.size > 0;
  const all = documents.length > 0 && selected.size === documents.length;
  const toggle = (id: string, range = false) => {
    setSelection(
      toggleDocumentSelection(
        selected,
        documents.map((d) => d.id),
        id,
        range ? anchor.current : null,
      ),
    );
    anchor.current = id;
  };
  const removeSelected = () =>
    setRemoving(documents.filter((d) => selected.has(d.id)));
  const confirmDelete = async () => {
    if (pending.current) return;
    pending.current = true;
    setDeleting(true);
    try {
      const result = await removeLibraryDocuments(removing.map((d) => d.id));
      setSelection(
        (current) =>
          new Set([...current].filter((id) => !result.deleted.includes(id))),
      );
      setRemoving((current) =>
        current.filter((d) => result.failed.includes(d.id)),
      );
      if (result.deleted.length)
        toast.success(`已删除 ${result.deleted.length} 份文档`);
      if (result.failed.length)
        toast.error(`${result.failed.length} 份文档删除失败，已保留，可重试`);
    } finally {
      pending.current = false;
      setDeleting(false);
    }
  };
  return (
    <section
      aria-label="文档列表"
      onKeyDown={(e) => {
        if (
          (e.target as Element).closest(
            'input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]',
          )
        )
          return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          setMode(true);
          setSelection(new Set(documents.map((d) => d.id)));
        }
        if (e.key === "Escape") {
          setMode(false);
          setSelection(new Set());
        }
      }}
    >
      <div className="library-selection-bar">
        <Button
          variant={selecting ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={selecting}
          onClick={() => {
            setMode(!selecting);
            setSelection(new Set());
          }}
        >
          <ListChecks />
          {selecting ? "取消多选" : "多选"}
        </Button>
        {selecting && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={all}
                indeterminate={selected.size > 0 && !all}
                onCheckedChange={() =>
                  setSelection(
                    all ? new Set() : new Set(documents.map((d) => d.id)),
                  )
                }
              />
              全选当前结果
            </label>
            <span className="text-sm text-muted-foreground" role="status">
              已选 {selected.size} 份
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              disabled={!selected.size}
              onClick={removeSelected}
            >
              <Trash2 />
              删除所选
            </Button>
          </>
        )}
      </div>
      <div className={`book-grid ${libraryView === "list" ? "book-list" : ""}`}>
        {documents.map((doc, i) => (
          <ContextMenu key={doc.id}>
            <ContextMenuTrigger
              render={<article />}
              className="book-card"
              data-selected={selected.has(doc.id)}
              tabIndex={0}
              aria-label={doc.title}
              onKeyDown={(e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  if (selecting || e.key === " ") toggle(doc.id, e.shiftKey);
                  else openDocument(doc);
                }
              }}
              onClickCapture={(e) => {
                if (
                  (selecting || e.metaKey || e.ctrlKey || e.shiftKey) &&
                  !(e.target as Element).closest(
                    '[data-document-action], [data-slot="checkbox"]',
                  )
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(doc.id, e.shiftKey);
                }
              }}
            >
              <div className="book-select" data-document-action>
                <Checkbox
                  checked={selected.has(doc.id)}
                  aria-label={`选择 ${doc.title}`}
                  onCheckedChange={() => toggle(doc.id)}
                />
              </div>
              <div className="book-cover-frame">
                <Button
                  variant="ghost"
                  title={doc.title}
                  aria-label={`打开 ${doc.title}`}
                  className={`book-cover cover-${i % 4}`}
                  onClick={() => openDocument(doc)}
                >
                  <div className="cover-top">
                    <span>{doc.type.toUpperCase()}</span>
                    {doc.type === "epub" ? (
                      <BookOpen size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                  </div>
                  <div className="cover-text">
                    <div className="cover-title">{doc.title}</div>
                    {doc.author && (
                      <div className="cover-author" title={doc.author}>
                        {doc.author}
                      </div>
                    )}
                  </div>
                  <div className="cover-bottom">
                    <ArrowUpRight size={18} />
                  </div>
                  <div className="cover-decoration" />
                </Button>
                {doc.type === "pdf" &&
                  (jobs.find((job) => job.documentId === doc.id) ? (
                    <CoverProcessing
                      job={jobs.find((job) => job.documentId === doc.id)!}
                      onSettings={onSettings}
                      unavailable={!!processingError}
                    />
                  ) : (
                    <Button
                      data-document-action
                      className="cover-analyze"
                      size="xs"
                      variant="secondary"
                      onClick={() =>
                        void api
                          .process(doc.id)
                          .catch((e) => toast.error(e.message))
                      }
                    >
                      分析文档
                    </Button>
                  ))}
              </div>
              <div className="book-meta">
                <Button
                  title={doc.title}
                  className="book-title"
                  variant="ghost"
                  onClick={() => openDocument(doc)}
                >
                  <span>{doc.title}</span>
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  data-document-action
                  aria-label={doc.favorite ? "取消收藏" : "收藏文档"}
                  onClick={() => void favorite(doc)}
                >
                  <Star
                    className={
                      doc.favorite ? "fill-current text-amber-500" : ""
                    }
                  />
                </Button>
              </div>
              <div className="document-organization">
                <DocumentBadges document={doc} />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`编辑 ${doc.title} 的信息`}
                  data-document-action
                  title="编辑文档信息"
                  onClick={() => onEdit(doc.id)}
                >
                  <Pencil />
                </Button>
              </div>
              {doc.categorySource !== "manual" &&
                (doc.classificationStatus === "failed" ||
                  doc.classificationStatus === "running") && (
                  <p className="classification-status">
                    {doc.classificationStatus === "failed"
                      ? "AI 分类失败 · 可手动修改或重试"
                      : "AI 分类中"}
                  </p>
                )}
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
                <span>{(doc.size / 1024 / 1024).toFixed(1)} MB</span>
              </p>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onEdit(doc.id)}>
                <Pencil />
                编辑文档信息
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => setRemoving([doc])}
              >
                <Trash2 />
                删除文档
              </ContextMenuItem>
              {selected.has(doc.id) && selected.size > 1 && (
                <ContextMenuItem variant="destructive" onClick={removeSelected}>
                  <Trash2 />
                  删除所选 {selected.size} 份文档
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <Dialog
        open={removing.length > 0}
        onOpenChange={(open) => {
          if (!open && !deleting) setRemoving([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 {removing.length} 份文档？</DialogTitle>
            <DialogDescription>
              将删除书库中的文档副本、笔记和阅读记录。导入前的原始文件会保留，此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 overflow-auto space-y-1 text-sm">
            {removing.map((d) => (
              <li key={d.id} className="truncate" title={d.title}>
                {d.title}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setRemoving([])}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "删除中…" : "删除文档"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
