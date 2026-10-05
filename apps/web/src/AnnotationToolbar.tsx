import type { RefObject } from "react";
import type { Annotation, SelectionAnchor } from "@reader/core";
import { Trash2, X } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import { SelectionToolbar } from "./SelectionToolbar";

export const annotationLabels = {
  highlight: "高亮",
  underline: "下划线",
  note: "笔记",
  bookmark: "书签",
};

export function AnnotationToolbar({
  annotations,
  anchor,
  pane,
  deleting,
  onDelete,
  onClose,
}: {
  annotations: Annotation[];
  anchor: SelectionAnchor;
  pane: RefObject<HTMLDivElement | null>;
  deleting: ReadonlySet<string>;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <SelectionToolbar anchor={anchor} pane={pane} label="批注操作">
      <div className="annotation-actions">
        <div className="annotation-actions-heading">
          <span>批注</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="关闭批注操作"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="annotation-actions-list">
          {annotations.map((annotation) => (
            <div className="annotation-action" key={annotation.id}>
              <div>
                <small>{annotationLabels[annotation.kind]}</small>
                <p>{annotation.note || annotation.quote}</p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`删除${annotationLabels[annotation.kind]}`}
                disabled={deleting.has(annotation.id)}
                onClick={() => onDelete(annotation.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </SelectionToolbar>
  );
}
