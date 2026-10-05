import { useState } from "react";
import { LayoutGrid, List, Plus, X } from "lucide-react";
import type { Document, DocumentCategory } from "@reader/core";
import { api } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import { Badge } from "@reader/ui/components/badge";
import { Input } from "@reader/ui/components/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";
import { toast } from "sonner";
import { refreshLibrary } from "./store";
import {
  categoryLabels,
  libraryTags,
  initialFilters,
  type LibraryFilters,
} from "./library";

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v);
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue>{options[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([value, text]) => (
          <SelectItem key={value} value={value}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function LibraryFilterBar({
  documents,
  filters,
  onChange,
  view,
  onViewChange,
  count,
}: {
  documents: Document[];
  filters: LibraryFilters;
  onChange: (value: LibraryFilters) => void;
  view: "grid" | "list";
  onViewChange: (value: "grid" | "list") => void;
  count: number;
}) {
  const tags = libraryTags(documents);
  const changed =
    filters.category !== "all" ||
    filters.format !== "all" ||
    filters.reading !== "all" ||
    filters.tags.length > 0;
  return (
    <div className="library-filter-bar">
      <Choice
        label="文档类型筛选"
        value={filters.category}
        options={{ all: "全部类型", ...categoryLabels }}
        onChange={(category) => onChange({ ...filters, category })}
      />
      <Choice
        label="文件格式筛选"
        value={filters.format}
        options={{ all: "全部格式", epub: "EPUB", pdf: "PDF" }}
        onChange={(format) => onChange({ ...filters, format })}
      />
      <Choice
        label="阅读状态筛选"
        value={filters.reading}
        options={{
          all: "全部阅读状态",
          unread: "未读",
          reading: "阅读中",
          finished: "已读完",
        }}
        onChange={(reading) => onChange({ ...filters, reading })}
      />
      <Select
        multiple
        value={filters.tags}
        onValueChange={(tags) => onChange({ ...filters, tags })}
      >
        <SelectTrigger aria-label="标签筛选（同时包含所选标签）">
          <SelectValue>
            {filters.tags.length ? `标签 · ${filters.tags.length}` : "全部标签"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {tags.length ? (
            tags.map((tag) => (
              <SelectItem key={tag.toLowerCase()} value={tag.toLowerCase()}>
                {tag}
              </SelectItem>
            ))
          ) : (
            <p className="p-3 text-sm text-muted-foreground">暂无标签</p>
          )}
        </SelectContent>
      </Select>
      <Choice
        label="文档排序"
        value={filters.sort}
        options={{ recent: "最近打开", added: "最近导入", title: "标题排序" }}
        onChange={(sort) => onChange({ ...filters, sort })}
      />
      {changed && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...initialFilters, sort: filters.sort })}
        >
          清除筛选
        </Button>
      )}
      <span className="text-xs text-muted-foreground" role="status">
        {count} 份文档
      </span>
      <div className="ml-auto flex gap-1">
        <Button
          size="icon-sm"
          variant={view === "grid" ? "secondary" : "ghost"}
          aria-label="网格视图"
          aria-pressed={view === "grid"}
          onClick={() => onViewChange("grid")}
        >
          <LayoutGrid />
        </Button>
        <Button
          size="icon-sm"
          variant={view === "list" ? "secondary" : "ghost"}
          aria-label="列表视图"
          aria-pressed={view === "list"}
          onClick={() => onViewChange("list")}
        >
          <List />
        </Button>
      </div>
      {filters.tags.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">同时包含</span>
          {filters.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tags.find((t) => t.toLowerCase() === tag) ?? tag}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`取消筛选 ${tag}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    tags: filters.tags.filter((t) => t !== tag),
                  })
                }
              >
                <X />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
export function DocumentBadges({ document: d }: { document: Document }) {
  return (
    <div className="document-badges">
      <Badge variant="secondary">{categoryLabels[d.category]}</Badge>
      {d.tags.map((tag) => (
        <Badge key={tag} variant="outline" className="max-w-full" title={tag}>
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
    </div>
  );
}
export function DocumentEditor({
  document: d,
  documents,
  onClose,
}: {
  document: Document;
  documents: Document[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(d.title);
  const [author, setAuthor] = useState(d.author);
  const [titleChanged, setTitleChanged] = useState(false);
  const [authorChanged, setAuthorChanged] = useState(false);
  const [category, setCategory] = useState(d.category);
  const [categoryChanged, setCategoryChanged] = useState(false);
  const [tags, setTags] = useState(d.tags);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestions = libraryTags(documents)
    .filter(
      (tag) =>
        !tags.some((t) => t.toLowerCase() === tag.toLowerCase()) &&
        tag.toLowerCase().includes(draft.trim().toLowerCase()),
    )
    .slice(0, 8);
  const addTag = (value: string) => {
    const tag = value.trim();
    if (!tag) return;
    if (Array.from(tag).length > 40 || /[\u0000-\u001f\u007f]/.test(tag)) {
      toast.error("标签最多 40 个字符，不能包含控制字符");
      return;
    }
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setDraft("");
      return;
    }
    if (tags.length >= 30) {
      toast.error("最多添加 30 个标签");
      return;
    }
    setTags([...tags, tag]);
    setDraft("");
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.update(d.id, {
        ...(titleChanged ? { title: title.trim() } : {}),
        ...(authorChanged ? { author: author.trim() } : {}),
        tags,
        ...(categoryChanged ? { category } : {}),
      });
      await refreshLibrary();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto">
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle>编辑文档信息</DialogTitle>
          <DialogDescription className="truncate" title={d.title}>
            {d.title}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <label htmlFor="document-title" className="text-sm font-medium">
              标题
            </label>
            <Input
              id="document-title"
              value={titleChanged ? title : d.title}
              maxLength={300}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleChanged(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="document-author" className="text-sm font-medium">
              作者
            </label>
            <Input
              id="document-author"
              value={authorChanged ? author : d.author}
              maxLength={200}
              onChange={(e) => {
                setAuthor(e.target.value);
                setAuthorChanged(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">文档类型（必选）</p>
            <Choice
              label="文档类型"
              value={categoryChanged ? category : d.category}
              options={categoryLabels}
              onChange={(v) => {
                setCategory(v as DocumentCategory);
                setCategoryChanged(true);
              }}
            />
            {d.classificationStatus === "failed" &&
              d.categorySource !== "manual" &&
              !categoryChanged && (
                <p
                  className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
                  role="status"
                >
                  {d.classificationError || "分类失败，可手动选择类型或重试。"}
                </p>
              )}
            {!categoryChanged && d.categorySource !== "manual" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCategory(d.category);
                  setCategoryChanged(true);
                }}
              >
                确认采用此类型
              </Button>
            )}
            {d.classificationStatus === "failed" && !categoryChanged && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.classify(d.id);
                    await refreshLibrary();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                重试 AI 分类
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="document-tag" className="text-sm font-medium">
              标签
            </label>
            <div className="document-badges">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="max-w-full">
                  <span className="truncate">{tag}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`移除标签 ${tag}`}
                    onClick={() => setTags(tags.filter((t) => t !== tag))}
                  >
                    <X />
                  </Button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                id="document-tag"
                value={draft}
                placeholder="输入标签，按回车添加"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addTag(draft);
                  }
                }}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="添加标签"
                disabled={!draft.trim()}
                onClick={() => addTag(draft)}
              >
                <Plus />
              </Button>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {suggestions.map((tag) => (
                  <Button
                    key={tag}
                    variant="ghost"
                    size="xs"
                    className="min-w-0 max-w-full"
                    title={tag}
                    onClick={() => addTag(tag)}
                  >
                    <span className="truncate">{tag}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              disabled={
                busy ||
                !(titleChanged ? title : d.title).trim() ||
                !!draft.trim()
              }
              onClick={() => void save()}
            >
              {busy ? "保存中…" : "保存"}
            </Button>
          </div>
          {!!draft.trim() && (
            <p className="text-xs text-muted-foreground">
              请先添加或清空输入中的标签。
            </p>
          )}
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}
