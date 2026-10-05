import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@reader/ui/components/resizable";

export function TranslationPanes({
  mode,
  swapped,
  onSwap,
  source,
  translation,
}: {
  mode: "source" | "parallel" | "translation";
  swapped: boolean;
  onSwap: () => void;
  source: ReactNode;
  translation: ReactNode;
}) {
  const id = useId();
  const sourcePanel = usePanelRef();
  const sourceWidth = useRef(50);
  const [dividerLeft, setDividerLeft] = useState(50);
  const parallel = mode === "parallel";
  const sourceId = `${id}-${swapped ? "right" : "left"}`;

  useLayoutEffect(() => {
    sourcePanel.current?.resize(
      `${mode === "source" ? 100 : mode === "translation" ? 0 : sourceWidth.current}%`,
    );
  }, [mode, swapped, sourcePanel]);

  // Stable React keys preserve the PDF instance when the panels change sides.
  // Positional panel IDs also refresh the resize library's left/right ordering.
  const panels = [
    <ResizablePanel
      key="source"
      id={sourceId}
      panelRef={sourcePanel}
      defaultSize={mode === "source" ? "100%" : "50%"}
      minSize={parallel ? "20%" : "0%"}
      className="translation-pane-content"
      style={{ overflow: "hidden" }}
      inert={mode === "translation"}
    >
      {source}
    </ResizablePanel>,
    <ResizableHandle
      key="divider"
      className="translation-divider"
      disabled={!parallel}
      hidden={!parallel}
      aria-label="调整原文和译文宽度"
    />,
    <ResizablePanel
      key="translation"
      id={`${id}-${swapped ? "left" : "right"}`}
      defaultSize={mode === "source" ? "0%" : "50%"}
      minSize={parallel ? "20%" : "0%"}
      className="translation-pane-content"
      style={{ overflow: "hidden" }}
      inert={mode === "source"}
    >
      {translation}
    </ResizablePanel>,
  ];

  return (
    <div className="translation-panes" data-mode={mode}>
      <ResizablePanelGroup
        orientation="horizontal"
        disabled={!parallel}
        onLayoutChange={(layout) => {
          if (parallel) setDividerLeft(layout[`${id}-left`]);
        }}
        onLayoutChanged={(layout, { isUserInteraction }) => {
          if (parallel && isUserInteraction)
            sourceWidth.current = layout[sourceId];
        }}
      >
        {swapped ? panels.reverse() : panels}
      </ResizablePanelGroup>
      {/* Overlay the divider outside the group so its capture-phase drag handler
          does not consume pointer events intended for this button. */}
      {parallel && (
        <Button
          className="translation-swap"
          style={{ left: `${dividerLeft}%` }}
          variant="outline"
          size="icon-xs"
          aria-label="交换原文和译文"
          title="交换原文和译文"
          onClick={onSwap}
        >
          <ArrowLeftRight />
        </Button>
      )}
    </div>
  );
}
