import { useEffect, useRef } from "react";
import type { Annotation } from "@reader/core";
import { api } from "@reader/api";
import { toast } from "sonner";
import { annotationUndoShortcut } from "../../../packages/reader-core/src/undo-shortcut";

export function useAnnotationUndo(
  documentId: string,
  onUndone: (annotations: Annotation[]) => void,
  blocked: () => boolean,
) {
  const live = useRef({ onUndone, blocked });
  live.current = { onUndone, blocked };
  useEffect(() => {
    let active = true;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !annotationUndoShortcut(event)) return;
      const target =
        event.target instanceof Element ? event.target : document.activeElement;
      // Let browser/editor history own text edits, including Markdown/chat inputs.
      if (
        target?.closest(
          'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]',
        )
      )
        return;
      if (live.current.blocked()) return;
      event.preventDefault();
      if (event.repeat) return;
      void api
        .undoAnnotation(documentId)
        .then((result) => {
          if (active && result.undone)
            live.current.onUndone(result.annotations);
        })
        .catch((error) => {
          if (active) toast.error((error as Error).message);
        });
    };
    window.addEventListener("keydown", key);
    return () => {
      active = false;
      window.removeEventListener("keydown", key);
    };
  }, [documentId]);
}
