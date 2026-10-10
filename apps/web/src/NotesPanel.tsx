import { AnnotationQuote } from "./AnnotationQuote";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Link,
  ListPlus,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  readerLink,
  locationLabel,
  type Annotation,
  type Document,
  type Message,
} from "@reader/core";
import { api } from "@reader/api";
import { Badge } from "@reader/ui/components/badge";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import { Textarea } from "@reader/ui/components/textarea";
import { ScrollArea } from "@reader/ui/components/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@reader/ui/components/collapsible";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@reader/ui/components/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@reader/ui/components/tabs";
import { toast } from "sonner";
import { annotationLabels } from "./AnnotationToolbar";
import { copyText } from "./chat/clipboard";
import { colorLabel, documentOrder, highlightPalette } from "./annotations";
import { useReaderStore } from "./store";
import { annotationDigest } from "./notes-export";

export { documentOrder };

export type NotesFilter =
  "all" | "highlight" | "note" | "question" | "bookmark";
const filterLabels: Record<NotesFilter, string> = {
  all: "全部",
  highlight: "划线",
  note: "批注",
  question: "问题",
  bookmark: "书签",
};

export const matchesFilter = (a: Annotation, filter: NotesFilter) =>
  filter === "all" ||
  (filter === "highlight"
    ? a.kind === "highlight" || a.kind === "underline"
    : a.kind === filter);

/** Tags typed as "a b, c" or "#a #b". */
export const parseTags = (text: string) => [
  ...new Set(text.split(/[\s,，、#]+/).filter(Boolean)),
];

/** Colors used by more than one kind of mark are worth filtering by. */
export function annotationFacets(annotations: Annotation[]) {
  const colors = new Map<string, string>();
  const tags = new Map<string, string>();
  for (const a of annotations) {
    if (a.kind !== "bookmark" && a.color)
      colors.set(a.color.toLowerCase(), a.color);
    for (const tag of a.tags || [])
      if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }
  return {
    colors: colors.size > 1 ? [...colors.values()] : [],
    tags: [...tags.values()].sort((a, b) => a.localeCompare(b, "zh")),
  };
}

export const isOpenQuestion = (a: Annotation) =>
  a.kind === "question" && !a.answerId && !a.resolved;

const plain = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`~$]+/g, "")
    .replace(/^\s*(?:#+|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

/** One free-form note per document, saved shortly after typing stops. */
function PaperNote({
  documentId,
  annotations,
}: {
  documentId: string;
  annotations: Annotation[];
}) {
  const [body, setBody] = useState("");
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved">(
    "loading",
  );
  const [open, setOpen] = useState(true);
  const saved = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let alive = true;
    void api
      .documentNote(documentId)
      .then((note) => {
        if (!alive) return;
        saved.current = note.body;
        setBody(note.body);
        setOpen(!!note.body);
        setState("idle");
      })
      .catch((e) => toast.error((e as Error).message));
    return () => {
      alive = false;
    };
  }, [documentId]);
  const save = async (text: string) => {
    clearTimeout(timer.current);
    if (text === saved.current) return;
    setState("saving");
    try {
      await api.saveDocumentNote(documentId, text);
      saved.current = text;
      setState("saved");
    } catch (e) {
      setState("idle");
      toast.error((e as Error).message);
    }
  };
  const digest =
    state === "loading"
      ? ""
      : annotationDigest(annotations, body, (a) =>
          readerLink({ id: documentId, annotation: a.id }),
        );
  // Save on unmount so switching documents never drops the last edit.
  const latest = useRef(body);
  latest.current = body;
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (latest.current !== saved.current)
        void api.saveDocumentNote(documentId, latest.current).catch(() => {});
    },
    [documentId],
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="paper-note">
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="sm" className="paper-note-toggle" />
        }
      >
        <ChevronDown data-open={open} />
        论文笔记
        <span className="ml-auto text-[10px] text-muted-foreground">
          {state === "saving" ? "保存中…" : state === "saved" ? "已保存" : ""}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Textarea
          aria-label="论文笔记"
          placeholder="记下整篇的要点、疑问和启发…"
          disabled={state === "loading"}
          value={body}
          onChange={(e) => {
            const text = e.target.value;
            setBody(text);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void save(text), 800);
          }}
          onBlur={() => void save(body)}
          className="paper-note-input"
        />
        <Button
          size="xs"
          variant="ghost"
          className="mt-1 text-muted-foreground"
          disabled={state === "loading" || !digest}
          title={digest ? undefined : "所有批注都已摘录"}
          onClick={() => {
            const text = body.trimEnd()
              ? `${body.trimEnd()}\n\n${digest}\n`
              : `${digest}\n`;
            setBody(text);
            void save(text);
          }}
        >
          <ListPlus />
          摘录批注
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NoteCard({
  annotation: a,
  answer,
  deleting,
  answering,
  onGo,
  onDelete,
  onSave,
  onAnswer,
  onResolve,
  onShowAnswer,
  onTag,
}: {
  annotation: Annotation;
  answer?: Message;
  deleting: boolean;
  answering: boolean;
  onGo: () => void;
  onDelete: () => void;
  onSave: (note: string, tags: string[]) => Promise<boolean>;
  onAnswer: () => void;
  onResolve: (resolved: boolean) => void;
  onShowAnswer: (id: string) => void;
  onTag: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.note);
  const [draftTags, setDraftTags] = useState("");
  const [saving, setSaving] = useState(false);
  const question = a.kind === "question";
  return (
    <article className="note-card" data-kind={a.kind}>
      <div>
        <Badge variant="outline">
          {annotationLabels[a.kind]}
          {question &&
            (a.answerId ? " · 已回答" : a.resolved ? " · 已解决" : "")}
        </Badge>
        <span className="flex items-center">
          {a.kind !== "bookmark" && !editing && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={question ? "编辑问题" : "编辑批注"}
              onClick={() => {
                setDraft(a.note);
                setDraftTags((a.tags || []).join(" "));
                setEditing(true);
              }}
            >
              <Pencil />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="复制链接"
            title="复制链接，可在笔记软件中点开回到这里"
            onClick={() =>
              void copyText(
                readerLink({ id: a.documentId, annotation: a.id }),
                "已复制链接",
              )
            }
          >
            <Link />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="删除记录"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </span>
      </div>
      <Button variant="ghost" className="note-quote" onClick={onGo}>
        <AnnotationQuote
          quote={a.quote || locationLabel(a.location)}
          location={a.location}
        />
      </Button>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            aria-label={question ? "问题" : "批注"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <Input
            aria-label="标签"
            placeholder="标签，用空格分隔"
            value={draftTags}
            onChange={(e) => setDraftTags(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-7 text-xs"
          />
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button
              size="xs"
              disabled={saving || (question && !draft.trim())}
              onClick={() => {
                setSaving(true);
                void onSave(draft, parseTags(draftTags))
                  .then((ok) => ok && setEditing(false))
                  .finally(() => setSaving(false));
              }}
            >
              <Check />
              保存
            </Button>
          </div>
        </div>
      ) : (
        <>
          {a.note && <p>{a.note}</p>}
          {!!a.tags?.length && (
            <div className="note-tags">
              {a.tags.map((tag) => (
                <Button
                  key={tag}
                  size="xs"
                  variant="ghost"
                  aria-label={`只看标签 ${tag}`}
                  onClick={() => onTag(tag)}
                >
                  #{tag}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      {question && !editing && (
        <div className="note-question">
          {a.answerId ? (
            <Button
              variant="ghost"
              className="note-answer"
              onClick={() => onShowAnswer(a.answerId!)}
            >
              <Sparkles className="size-3" />
              <span>
                {answer ? plain(answer.content).slice(0, 180) : "查看回答"}
              </span>
            </Button>
          ) : a.resolved ? (
            <Button size="xs" variant="ghost" onClick={() => onResolve(false)}>
              重新打开
            </Button>
          ) : (
            <>
              <Button
                size="xs"
                variant="secondary"
                disabled={answering}
                onClick={onAnswer}
              >
                {answering ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                让 AI 回答
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onResolve(true)}>
                标为已解决
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function NotesPanel({
  document: doc,
  annotations,
  messages,
  deleting,
  answering,
  onGo,
  onDelete,
  onSave,
  onAnswer,
  onResolve,
  onShowAnswer,
  onExport,
}: {
  document: Document;
  annotations: Annotation[];
  messages: Message[];
  deleting: ReadonlySet<string>;
  answering: ReadonlySet<string>;
  onGo: (annotation: Annotation) => void;
  onDelete: (id: string) => void;
  onSave: (
    annotation: Annotation,
    patch: { note: string; tags: string[] },
  ) => Promise<boolean>;
  onAnswer: (annotation: Annotation) => void;
  onResolve: (annotation: Annotation, resolved: boolean) => void;
  onShowAnswer: (id: string) => void;
  onExport: () => void;
}) {
  const [filter, setFilter] = useState<NotesFilter>("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [color, setColor] = useState("");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(""), [doc.id]);
  const query = search.trim().toLocaleLowerCase();
  const facets = annotationFacets(annotations);
  const palette = highlightPalette(useReaderStore((s) => s.theme));
  // A facet that no longer exists (deleted, retagged) stops filtering.
  const activeColor = facets.colors.some(
    (c) => c.toLowerCase() === color.toLowerCase(),
  )
    ? color
    : "";
  const activeTag = facets.tags.some(
    (t) => t.toLowerCase() === tag.toLowerCase(),
  )
    ? tag
    : "";
  const counts = Object.fromEntries(
    (Object.keys(filterLabels) as NotesFilter[]).map((key) => [
      key,
      annotations.filter((a) => matchesFilter(a, key)).length,
    ]),
  ) as Record<NotesFilter, number>;
  const open = annotations.filter(isOpenQuestion).length;
  const visible = annotations
    .filter(
      (a) =>
        matchesFilter(a, filter) &&
        (!openOnly || filter !== "question" || isOpenQuestion(a)) &&
        (!activeColor ||
          (a.kind !== "bookmark" &&
            a.color.toLowerCase() === activeColor.toLowerCase())) &&
        (!activeTag ||
          !!a.tags?.some((t) => t.toLowerCase() === activeTag.toLowerCase())) &&
        (!query || `${a.quote} ${a.note}`.toLocaleLowerCase().includes(query)),
    )
    .sort(documentOrder);
  const byId = new Map(messages.map((m) => [m.id, m]));
  return (
    <div className="notes-panel">
      <div className="notes-search">
        <Search aria-hidden="true" />
        <Input
          type="search"
          aria-label="搜索批注内容"
          placeholder="搜索批注内容"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="notes-list">
          <PaperNote
            key={doc.id}
            documentId={doc.id}
            annotations={annotations}
          />
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as NotesFilter)}
          >
            <TabsList aria-label="筛选记录" className="notes-filter">
              {(Object.keys(filterLabels) as NotesFilter[]).map((key) => (
                <TabsTrigger key={key} value={key} className="px-2 text-xs">
                  {filterLabels[key]}
                  {key !== "all" && counts[key] > 0 && (
                    <small className="text-muted-foreground">
                      {counts[key]}
                    </small>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {(facets.colors.length > 0 || facets.tags.length > 0) && (
            <div className="notes-facets">
              {facets.colors.length > 0 && (
                <ToggleGroup
                  aria-label="按颜色筛选"
                  size="sm"
                  spacing={0}
                  value={activeColor ? [activeColor] : []}
                  onValueChange={(value: string[]) => setColor(value[0] || "")}
                >
                  {facets.colors.map((c) => (
                    <ToggleGroupItem
                      key={c}
                      value={c}
                      aria-label={`只看${colorLabel(c, palette)}`}
                      title={colorLabel(c, palette)}
                      className="size-7 min-w-7 px-0"
                    >
                      <span className="color-dot" style={{ background: c }} />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              {facets.tags.length > 0 && (
                <ToggleGroup
                  aria-label="按标签筛选"
                  size="sm"
                  spacing={0}
                  value={activeTag ? [activeTag] : []}
                  onValueChange={(value: string[]) => setTag(value[0] || "")}
                >
                  {facets.tags.map((t) => (
                    <ToggleGroupItem key={t} value={t} className="px-2 text-xs">
                      #{t}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            </div>
          )}
          {filter === "question" && open > 0 && (
            <Button
              size="xs"
              variant={openOnly ? "secondary" : "ghost"}
              aria-pressed={openOnly}
              className="mb-2"
              onClick={() => setOpenOnly(!openOnly)}
            >
              <CircleHelp />
              只看待回答（{open}）
            </Button>
          )}
          {!visible.length && (
            <div className="notes-empty">
              <StickyNote />
              <p>
                {query
                  ? "没有匹配的记录"
                  : annotations.length
                    ? "没有这类记录"
                    : "暂无批注"}
              </p>
              {!annotations.length && (
                <small>选中文字添加高亮、批注或问题。</small>
              )}
            </div>
          )}
          {visible.map((a) => (
            <NoteCard
              key={a.id}
              annotation={a}
              answer={a.answerId ? byId.get(a.answerId) : undefined}
              deleting={deleting.has(a.id)}
              answering={answering.has(a.id)}
              onGo={() => onGo(a)}
              onDelete={() => onDelete(a.id)}
              onSave={(note, tags) => onSave(a, { note, tags })}
              onTag={setTag}
              onAnswer={() => onAnswer(a)}
              onResolve={(resolved) => onResolve(a, resolved)}
              onShowAnswer={onShowAnswer}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="notes-footer">
        <span>{annotations.length} 条记录</span>
        <Button size="sm" variant="ghost" onClick={onExport}>
          <Download />
          导出
        </Button>
      </div>
    </div>
  );
}
