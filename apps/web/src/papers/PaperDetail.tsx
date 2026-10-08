import { useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  Quote,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import type {
  Creator,
  Document,
  PaperItemType,
  PaperMetadataField,
} from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import { Textarea } from "@reader/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@reader/ui/components/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@reader/ui/components/dropdown-menu";
import { useReaderStore } from "../store";
import {
  lookupPaper,
  openLink,
  patchPapers,
  setStarred,
  toggleCategory,
} from "./actions";
import { copyText } from "../chat/clipboard";
import {
  creatorName,
  formatCreators,
  itemTypeLabels,
  paperCreators,
  paperLink,
  parseCreators,
  relativeTime,
} from "./format";
import { paperCategories } from "./model";
import { PaperMenuItems, type PaperMenuActions } from "./PaperMenu";
import { CitationMenuItems } from "./CitationMenu";
import { RelatedPapers } from "./RelatedPapers";

const fieldLabels: Partial<Record<PaperMetadataField, string>> = {
  date: "日期",
  venue: "出处",
  volume: "卷",
  issue: "期",
  pages: "页码",
  publisher: "出版者",
  doi: "DOI",
  arxiv: "arXiv",
  url: "链接",
  affiliation: "单位",
  shortTitle: "短标题",
  translatedTitle: "译名",
  abstract: "摘要",
};
const placeholders: Partial<Record<PaperMetadataField, string>> = {
  date: "2024 或 2024-05-17",
  doi: "10.xxxx/… 或 doi.org 链接",
  arxiv: "2401.01234",
  url: "https://",
  translatedTitle: "译名",
};

function saveField(doc: Document, key: PaperMetadataField, value: unknown) {
  return patchPapers([[doc, { metadata: { [key]: value } }]]);
}

/** A text field that saves on blur or Enter and restores on Escape. */
function Field({
  doc,
  name,
  multiline = false,
}: {
  doc: Document;
  name: PaperMetadataField;
  multiline?: boolean;
}) {
  const value = String(doc.metadata[name] ?? "");
  const commit = (next: string) => {
    if (next.trim() !== value) void saveField(doc, name, next.trim());
  };
  const props = {
    // Remount when the saved value changes so the field shows it.
    key: `${doc.id}:${value}`,
    defaultValue: value,
    "aria-label": fieldLabels[name],
    placeholder: placeholders[name] || "—",
    className: "paper-field-input",
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      commit(e.currentTarget.value),
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (e.key === "Escape") {
        e.currentTarget.value = value;
        e.currentTarget.blur();
      }
      if (e.key === "Enter" && !multiline && !e.nativeEvent.isComposing) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
  };
  return multiline ? <Textarea rows={1} {...props} /> : <Input {...props} />;
}

export function PaperDetail({
  doc,
  actions,
}: {
  doc: Document;
  actions: PaperMenuActions;
}) {
  const all = useReaderStore((s) => s.documents);
  const prefs = useReaderStore((s) => s.libraryPreferences.papers) || {};
  const categories = paperCategories(
    prefs,
    all.filter((d) => d.library === "papers"),
  );
  const [abstractOpen, setAbstractOpen] = useState(false);
  const [editingAbstract, setEditingAbstract] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const m = doc.metadata;
  const link = paperLink(m);
  const percent = Math.round(doc.percentage * 100);
  return (
    <aside className="paper-detail" aria-label="论文详情">
      <div className="paper-detail-body">
        <div className="paper-detail-actions">
          <Button size="sm" onClick={() => actions.open(doc)}>
            <BookOpen />
            {percent > 1 ? `继续阅读 · ${percent}%` : "开始阅读"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" variant="outline" />}
            >
              <Quote />
              引用
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <CitationMenuItems kind="dropdown" docs={[doc]} />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={doc.favorite ? "取消星标" : "加星标"}
            aria-pressed={doc.favorite}
            onClick={() => void setStarred([doc], !doc.favorite)}
          >
            <Star
              className={doc.favorite ? "fill-current text-amber-500" : ""}
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="更多操作"
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <PaperMenuItems kind="dropdown" docs={[doc]} actions={actions} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Textarea
          key={`${doc.id}:${doc.title}`}
          rows={1}
          aria-label="标题"
          className="paper-title-input"
          defaultValue={doc.title}
          onBlur={(e) => {
            const title = e.currentTarget.value.trim();
            if (!title) e.currentTarget.value = doc.title;
            else if (title !== doc.title) void patchPapers([[doc, { title }]]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <Field doc={doc} name="translatedTitle" multiline />
        <div className="paper-categories" aria-label="分类">
          {categories.map((name) => {
            const on = doc.tags.some(
              (t) => t.toLowerCase() === name.toLowerCase(),
            );
            return (
              <Button
                key={name}
                size="xs"
                variant={on ? "secondary" : "ghost"}
                aria-pressed={on}
                className="paper-category-chip"
                onClick={() => void toggleCategory(doc, name)}
              >
                {name.replaceAll("/", " / ")}
              </Button>
            );
          })}
          <Button
            size="xs"
            variant="ghost"
            className="paper-category-chip"
            onClick={() => actions.newCategory([doc])}
          >
            <Plus />
            新分类
          </Button>
        </div>
        <div className="paper-fields-heading">
          <h3>文献信息</h3>
          {m.lookup === "pending" && (
            <span className="text-xs text-muted-foreground">
              解析后自动查找
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            disabled={lookingUp}
            title="按 DOI、arXiv 编号或标题查找"
            onClick={() => {
              setLookingUp(true);
              void lookupPaper(doc).finally(() => setLookingUp(false));
            }}
          >
            {lookingUp ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            查找文献信息
          </Button>
        </div>
        <dl className="paper-fields">
          <dt>类型</dt>
          <dd>
            <Select
              value={m.itemType || ""}
              onValueChange={(value) => {
                if (value) void saveField(doc, "itemType", value);
              }}
            >
              <SelectTrigger size="sm" aria-label="文献类型" className="w-full">
                <SelectValue>
                  {m.itemType ? itemTypeLabels[m.itemType] : "未设置"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(itemTypeLabels) as PaperItemType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {itemTypeLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </dd>
          <dt>作者</dt>
          <dd>
            <AuthorChips doc={doc} />
          </dd>
          <FieldRow doc={doc} name="date" />
          <FieldRow doc={doc} name="doi" />
          <FieldRow doc={doc} name="arxiv" />
          <dt>链接</dt>
          <dd className="flex items-center gap-1">
            <Field doc={doc} name="url" />
            {link && (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="打开论文主页"
                title={link}
                onClick={() => openLink(link)}
              >
                <ExternalLink />
              </Button>
            )}
          </dd>
          {(
            [
              "venue",
              "volume",
              "issue",
              "pages",
              "publisher",
              "affiliation",
            ] as PaperMetadataField[]
          ).map((name) => (
            <FieldRow key={name} doc={doc} name={name} />
          ))}
          <FieldRow doc={doc} name="shortTitle" />
          <dt>添加于</dt>
          <dd className="paper-field-static">
            {relativeTime(doc.createdAt)}
            {Date.parse(doc.lastOpenedAt) - Date.parse(doc.createdAt) > 1000 &&
              ` · 上次打开 ${relativeTime(doc.lastOpenedAt)}`}
          </dd>
        </dl>
        {(doc.noteCount > 0 ||
          doc.highlightCount > 0 ||
          doc.openQuestionCount > 0) && (
          <p className="paper-annotation-counts">
            {[
              doc.noteCount && `${doc.noteCount} 条笔记`,
              doc.highlightCount && `${doc.highlightCount} 处划线`,
              doc.openQuestionCount && `${doc.openQuestionCount} 个问题待回答`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <section className="paper-abstract">
          <div className="flex items-center justify-between">
            <h3>摘要</h3>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setEditingAbstract(!editingAbstract)}
            >
              {editingAbstract ? "完成" : m.abstract ? "编辑" : "添加"}
            </Button>
          </div>
          {editingAbstract ? (
            <Field doc={doc} name="abstract" multiline />
          ) : m.abstract ? (
            <>
              <p data-open={abstractOpen}>{m.abstract}</p>
              <Button
                size="xs"
                variant="link"
                className="px-0"
                onClick={() => setAbstractOpen(!abstractOpen)}
              >
                {abstractOpen ? "收起" : "展开全文"}
              </Button>
            </>
          ) : null}
        </section>
        <RelatedPapers doc={doc} />
      </div>
    </aside>
  );
}

function FieldRow({ doc, name }: { doc: Document; name: PaperMetadataField }) {
  return (
    <>
      <dt>{fieldLabels[name]}</dt>
      <dd>
        <Field doc={doc} name={name} />
      </dd>
    </>
  );
}

/** One capsule per author: click copies, double click edits, × removes. */
function AuthorChips({ doc }: { doc: Document }) {
  const creators = paperCreators(doc);
  const [editing, setEditing] = useState<number | null>(null);
  const save = (next: Creator[]) => {
    if (JSON.stringify(next) !== JSON.stringify(doc.metadata.creators || []))
      void saveField(doc, "creators", next);
  };
  const commit = (index: number, text: string) => {
    setEditing(null);
    const parsed = parseCreators(text.replace(/\n/g, " "));
    const next = [...creators];
    next.splice(index, 1, ...parsed.slice(0, 1));
    if (index < creators.length || parsed.length) save(next);
  };
  const input = (index: number, value: string) => (
    <Input
      key={`edit-${index}`}
      autoFocus
      aria-label={index < creators.length ? "编辑作者" : "添加作者"}
      placeholder="姓, 名"
      defaultValue={value}
      className="paper-author-input"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commit(index, e.currentTarget.value);
        }
        if (e.key === "Escape") setEditing(null);
      }}
      onBlur={(e) => {
        if (editing === index) commit(index, e.currentTarget.value);
      }}
    />
  );
  return (
    <div className="paper-authors" aria-label="作者">
      {creators.map((c, index) =>
        editing === index ? (
          input(index, formatCreators([c]))
        ) : (
          <span key={index} className="paper-author-chip">
            <Button
              size="xs"
              variant="ghost"
              title="单击复制，双击编辑"
              onClick={() => void copyText(creatorName(c), "已复制作者")}
              onDoubleClick={() => setEditing(index)}
            >
              {creatorName(c)}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`删除作者 ${creatorName(c)}`}
              onClick={() => save(creators.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </span>
        ),
      )}
      {editing === creators.length ? (
        input(creators.length, "")
      ) : (
        <Button
          size="icon-xs"
          variant="ghost"
          className="rounded-full"
          aria-label="添加作者"
          onClick={() => setEditing(creators.length)}
        >
          <Plus />
        </Button>
      )}
    </div>
  );
}
