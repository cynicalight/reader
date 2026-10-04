import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { blockImageURL } from "@reader/api";
import type { ImageAttachment } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";
export function imageLabel(image: ImageAttachment) {
  const kind = /formula|equation/.test(image.label)
    ? "公式"
    : /table/.test(image.label)
      ? "表格"
      : "图表";
  return `第 ${image.page} 页 · ${kind}`;
}
export function ImagePreview({
  documentId,
  image,
  onClose,
  renderImage,
}: {
  documentId: string;
  image: ImageAttachment;
  onClose: () => void;
  renderImage?: (id: string, signal: AbortSignal) => Promise<Blob>;
}) {
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [error, setError] = useState(false);
  const [highResolution, setHighResolution] = useState<string>();
  const [rendering, setRendering] = useState(!!renderImage);
  useEffect(() => {
    if (!renderImage) return;
    const controller = new AbortController();
    let url: string | undefined;
    void renderImage(image.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setHighResolution(url);
        setError(false);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setRendering(false);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [image.id, renderImage]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="image-preview-dialog">
        <DialogHeader>
          <DialogTitle>{imageLabel(image)}</DialogTitle>
          <DialogDescription className="sr-only">
            附件原图，可放大查看细节
          </DialogDescription>
        </DialogHeader>
        <div className="image-preview-controls">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="缩小图片"
            disabled={zoom <= 0.5}
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            <Minus />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
            适应窗口
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="放大图片"
            disabled={zoom >= 4}
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
          >
            <Plus />
          </Button>
          {rendering ? (
            <span>正在加载高清预览…</span>
          ) : (
            size && (
              <span>
                {size.width} × {size.height}
              </span>
            )
          )}
        </div>
        <div className="image-preview-scroll">
          {error ? (
            <p role="alert">图片暂时无法加载，请稍后重试。</p>
          ) : (
            <img
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              src={highResolution || blockImageURL(documentId, image.id)}
              alt={image.caption || imageLabel(image)}
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setError(true)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
