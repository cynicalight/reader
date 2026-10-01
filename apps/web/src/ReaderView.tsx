import { useEffect, useRef, useState } from "react";
import type {
  Annotation,
  Document,
  ReaderAdapter,
  ReaderEvents,
  ReaderTheme,
  TOCItem,
} from "@reader/core";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
export function ReaderView({
  document: doc,
  theme,
  annotations,
  onReady,
  events,
}: {
  document: Document;
  theme: ReaderTheme;
  annotations: Annotation[];
  onReady: (adapter: ReaderAdapter, toc: TOCItem[]) => void;
  events: ReaderEvents;
}) {
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<ReaderAdapter | null>(null);
  const latest = useRef({ theme, annotations, events, onReady });
  latest.current = { theme, annotations, events, onReady };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const container = document.createElement("div");
    container.className = "reader-engine";
    host.current!.append(container);
    let engine: ReaderAdapter | undefined;
    const setup = async () => {
      const { PDFReaderAdapter } =
        doc.type === "pdf"
          ? await import("./readers/pdf")
          : { PDFReaderAdapter: undefined };
      const { EPUBReaderAdapter } =
        doc.type === "epub"
          ? await import("./readers/epub")
          : { EPUBReaderAdapter: undefined };
      if (disposed) return;
      const Engine = PDFReaderAdapter || EPUBReaderAdapter!;
      engine = new Engine(container, {
        location: (...args) => {
          if (!disposed) latest.current.events.location(...args);
        },
        selection: (selection) => {
          if (!disposed) latest.current.events.selection(selection);
        },
      });
      await engine.open(doc);
      if (disposed) return;
      await engine.setTheme(latest.current.theme);
      await engine.highlight(latest.current.annotations);
      const toc = await engine.getTOC();
      if (disposed) return;
      adapter.current = engine;
      latest.current.onReady(engine, toc);
      setLoading(false);
    };
    const pending = setup().catch((e) => {
      if (!disposed) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      adapter.current = null;
      void pending
        .finally(async () => {
          await engine?.destroy();
          container.remove();
        })
        .catch(() => {});
    };
  }, [doc.id]);
  useEffect(() => {
    void adapter.current?.setTheme(theme).catch((e) => toast.error(e.message));
  }, [theme]);
  useEffect(() => {
    void adapter.current
      ?.highlight(annotations)
      .catch((e) => toast.error(e.message));
  }, [annotations]);
  return (
    <div className="reader-stage" data-theme={theme.mode}>
      <div className="reader-host" ref={host} />
      {loading && (
        <div className="reader-loading">
          <Loader2 className="animate-spin" />
          <p>正在排版，准备阅读…</p>
        </div>
      )}
      {error && (
        <div className="reader-loading">
          <h3>这份文档暂时无法打开</h3>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
