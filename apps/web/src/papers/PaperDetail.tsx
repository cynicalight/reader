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
  Document,
  PaperItemType,
  PaperMetadataField,
  ReadingStatus,
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
  ToggleGroup,
  ToggleGroupItem,
} from "@reader/ui/components/toggle-group";
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
  setReadingStatus,
  setStarred,
  toggleCategory,
} from "./actions";
import {
  formatCreators,
  itemTypeLabels,
  paperLink,
  parseCreators,
  relativeTime,
} from "./format";
import { paperCategories, statusLabels } from "./model";
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
  onClose,
}: {
  doc: Document;
  actions: PaperMenuActions;
  onClose: () => void;
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
      <header className="paper-detail-header">
        <span>论文详情</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="关闭详情"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
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
        <ToggleGroup
          aria-label="阅读状态"
          variant="outline"
          size="sm"
          spacing={0}
          value={[doc.readingStatus]}
          onValueChange={(value: string[]) => {
            if (value[0])
              void setReadingStatus([doc], value[0] as ReadingStatus);
          }}
        >
          {(Object.keys(statusLabels) as ReadingStatus[]).map((key) => (
            <ToggleGroupItem key={key} value={key} className="px-3">
              {statusLabels[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
            <Textarea
              key={`${doc.id}:${JSON.stringify(m.creators)}:${doc.author}`}
              rows={1}
              aria-label="作者，每行一位"
              placeholder="每行一位：姓, 名"
              className="paper-field-input"
              defaultValue={formatCreators(
                m.creators?.length
                  ? m.creators
                  : parseCreators(
                      doc.author.split(/\s*[,;，；]\s*/).join("\n"),
                    ),
              )}
              onBlur={(e) => {
                const creators = parseCreators(e.currentTarget.value);
                if (
                  JSON.stringify(creators) !== JSON.stringify(m.creators || [])
                )
                  void saveField(doc, "creators", creators);
              }}
            />
          </dd>
          {(
            [
              "date",
              "venue",
              "volume",
              "issue",
              "pages",
              "publisher",
              "doi",
              "arxiv",
            ] as PaperMetadataField[]
          ).map((name) => (
            <FieldRow key={name} doc={doc} name={name} />
          ))}
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
          <FieldRow doc={doc} name="affiliation" />
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
