import type { RefObject } from "react";
import type { Annotation, SelectionAnchor } from "@reader/core";
import { Trash2, StickyNote, SquarePen, Sparkles } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@reader/ui/components/tooltip";
import { SelectionToolbar } from "./SelectionToolbar";

export const annotationLabels = {
  highlight: "高亮",
  underline: "下划线",
  note: "笔记",
  question: "问题",
  bookmark: "书签",
};

export function AnnotationToolbar({
  annotation,
  anchor,
  pane,
  deleting = false,
  onDelete,
  onNote,
  onAskAI,
  onAnswer,
}: {
  annotation: Annotation;
  anchor: SelectionAnchor;
  pane: RefObject<HTMLDivElement | null>;
  deleting?: boolean;
  onDelete: (id: string) => void;
  onNote: (annotation: Annotation) => void;
  onAskAI: (annotation: Annotation) => void;
  onAnswer?: (annotation: Annotation) => void;
}) {
  const hasNote = !!annotation.note.trim();
  const question = annotation.kind === "question";
  const actions = [
    {
      label: question ? "编辑问题" : hasNote ? "编辑笔记" : "添加笔记",
      Icon: hasNote ? SquarePen : StickyNote,
      onClick: () => onNote(annotation),
    },
    question && onAnswer && !annotation.answerId
      ? {
          label: "让 AI 回答",
          Icon: Sparkles,
          onClick: () => onAnswer(annotation),
        }
      : { label: "问 AI", Icon: Sparkles, onClick: () => onAskAI(annotation) },
    {
      label: `删除${annotationLabels[annotation.kind]}`,
      Icon: Trash2,
      onClick: () => onDelete(annotation.id),
    },
  ];
  return (
    <SelectionToolbar anchor={anchor} pane={pane} label="批注操作">
      {actions.map(({ label, Icon, onClick }) => (
        <Tooltip key={label}>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={label}
                disabled={deleting}
                onClick={onClick}
              />
            }
          >
            <Icon />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </SelectionToolbar>
  );
}
