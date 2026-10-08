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
import { toast } from "sonner";
import { annotationLabels } from "./AnnotationToolbar";
import { copyText } from "./chat/clipboard";
import { documentOrder } from "./annotations";
import { annotationDigest } from "./notes-export";

export { documentOrder };

export type NotesFilter =
  "all" | "highlight" | "note" | "question" | "bookmark";
const filterLabels: Record<NotesFilter, string> = {
  all: "全部",
  highlight: "划线",
  note: "笔记",
  question: "问题",
  bookmark: "书签",
};

export const matchesFilter = (a: Annotation, filter: NotesFilter) =>
  filter === "all" ||
  (filter === "highlight"
    ? a.kind === "highlight" || a.kind === "underline"
    : a.kind === filter);

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
}: {
  annotation: Annotation;
  answer?: Message;
  deleting: boolean;
  answering: boolean;
  onGo: () => void;
  onDelete: () => void;
  onSave: (note: string) => Promise<boolean>;
  onAnswer: () => void;
  onResolve: (resolved: boolean) => void;
  onShowAnswer: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.note);
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
              aria-label={question ? "编辑问题" : "编辑笔记"}
              onClick={() => {
                setDraft(a.note);
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
        {a.quote || locationLabel(a.location)}
      </Button>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            aria-label={question ? "问题" : "笔记"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
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
                void onSave(draft)
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
        a.note && <p>{a.note}</p>
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
  onSave: (annotation: Annotation, note: string) => Promise<boolean>;
  onAnswer: (annotation: Annotation) => void;
  onResolve: (annotation: Annotation, resolved: boolean) => void;
  onShowAnswer: (id: string) => void;
  onExport: () => void;
}) {
  const [filter, setFilter] = useState<NotesFilter>("all");
  const [openOnly, setOpenOnly] = useState(false);
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
        (!openOnly || filter !== "question" || isOpenQuestion(a)),
    )
    .sort(documentOrder);
  const byId = new Map(messages.map((m) => [m.id, m]));
  return (
    <div className="notes-panel">
      <div className="notes-heading">
        <span>{annotations.length} 条记录</span>
        <Button size="sm" variant="ghost" onClick={onExport}>
          <Download />
          导出
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="notes-list">
          <PaperNote
            key={doc.id}
            documentId={doc.id}
            annotations={annotations}
          />
          <ToggleGroup
            aria-label="筛选记录"
            size="sm"
            spacing={0}
            variant="outline"
            className="notes-filter"
            value={[filter]}
            onValueChange={(value: string[]) =>
              value[0] && setFilter(value[0] as NotesFilter)
            }
          >
            {(Object.keys(filterLabels) as NotesFilter[]).map((key) => (
              <ToggleGroupItem key={key} value={key} className="px-2 text-xs">
                {filterLabels[key]}
                {key !== "all" && counts[key] > 0 && (
                  <small className="ml-0.5 text-muted-foreground">
                    {counts[key]}
                  </small>
                )}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
              <p>{annotations.length ? "没有这类记录" : "暂无笔记"}</p>
              {!annotations.length && (
                <small>选中文字添加高亮、笔记或问题。</small>
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
              onSave={(note) => onSave(a, note)}
              onAnswer={() => onAnswer(a)}
              onResolve={(resolved) => onResolve(a, resolved)}
              onShowAnswer={onShowAnswer}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
