type Render = (
  blockId: string,
  signal: AbortSignal,
  width: number,
) => Promise<Blob>;

/** Sharp PDF block images, rendered once per block and reused across panes. */
export function blockImageCache(render: Render) {
  const controller = new AbortController();
  const entries = new Map<string, { width: number; url: Promise<string> }>();
  const urls: string[] = [];
  return {
    url(blockId: string, width: number) {
      // Coarse steps keep pane resizes from re-rendering every figure.
      width = Math.ceil(width / 256) * 256;
      const entry = entries.get(blockId);
      if (entry && entry.width >= width) return entry.url;
      const url = render(blockId, controller.signal, width).then((blob) => {
        const url = URL.createObjectURL(blob);
        if (controller.signal.aborted) URL.revokeObjectURL(url);
        else urls.push(url);
        return url;
      });
      url.catch(() => {
        if (entries.get(blockId)?.url === url) entries.delete(blockId);
      });
      entries.set(blockId, { width, url });
      return url;
    },
    dispose() {
      controller.abort();
      urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
      entries.clear();
    },
  };
}
