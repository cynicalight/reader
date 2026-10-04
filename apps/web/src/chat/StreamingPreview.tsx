import { Profiler, useEffect, useRef, useState } from "react";
import { Button } from "@reader/ui/components/button";
import { ScrollArea } from "@reader/ui/components/scroll-area";
import { MessageMarkdown } from "./MessageMarkdown";
import { copyText } from "./clipboard";
import {
  markdownFixture,
  sizedFixture,
  splitFixture,
  type SplitMode,
} from "./fixtures";
import { useChatScroll } from "./useChatScroll";
export default function StreamingPreview() {
  const [raw, setRaw] = useState("");
  const [running, setRunning] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [dark, setDark] = useState(false);
  const [mode, setMode] = useState<SplitMode>("random");
  const [size, setSize] = useState(0);
  const [run, setRun] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const metrics = useRef({
    commits: 0,
    reactMs: 0,
    longTasks: 0,
    longTaskMs: 0,
    terminalAt: 0,
    terminalCommitMs: 0,
  });
  const [report, setReport] = useState("");
  const scroll = useChatScroll(run);
  useEffect(() => {
    let observer: PerformanceObserver | undefined;
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          metrics.current.longTasks++;
          metrics.current.longTaskMs += entry.duration;
        }
      });
      observer.observe({ type: "longtask", buffered: false });
    }
    return () => {
      clearTimeout(timer.current);
      observer?.disconnect();
    };
  }, []);
  const stop = () => {
    clearTimeout(timer.current);
    metrics.current.terminalAt = performance.now();
    setRunning(false);
  };
  const start = () => {
    clearTimeout(timer.current);
    metrics.current = {
      commits: 0,
      reactMs: 0,
      longTasks: 0,
      longTaskMs: 0,
      terminalAt: 0,
      terminalCommitMs: 0,
    };
    const source = size ? sizedFixture(size) : markdownFixture;
    // Sized runs use 4KiB code-unit chunks, 20ms apart for a bounded, repeatable benchmark.
    const chunks =
      size && mode !== "whole"
        ? source.match(/[\s\S]{1,4096}/gu)!
        : splitFixture(source, mode);
    let i = 0,
      text = "";
    setRaw("");
    setRunning(true);
    setRun((value) => value + 1);
    const tick = () => {
      text += chunks[i++] || "";
      setRaw(text);
      if (i < chunks.length) timer.current = setTimeout(tick, 20);
      else stop();
    };
    timer.current = setTimeout(tick, 20);
  };
  return (
    <main
      className={dark ? "dark" : ""}
      style={{
        height: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>
          分片{" "}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SplitMode)}
          >
            {["character", "word", "random", "whole"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          样本{" "}
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            <option value={0}>Markdown</option>
            <option value={10240}>10KB</option>
            <option value={102400}>100KB</option>
            <option value={1048500}>接近 1MiB</option>
          </select>
        </label>
        <Button onClick={() => setAnimated(!animated)}>
          动画：{animated ? "开" : "关"}
        </Button>
        <Button onClick={() => setDark(!dark)}>深浅主题</Button>
        <Button onClick={start}>回放</Button>
        <Button onClick={stop}>停止</Button>
        <Button onClick={() => void copyText(raw)}>复制原文</Button>
        <Button
          onClick={() =>
            setReport(
              JSON.stringify(
                {
                  ...metrics.current,
                  bytes: new TextEncoder().encode(raw).length,
                  memory: (performance as Performance & { memory?: unknown })
                    .memory,
                  userAgent: navigator.userAgent,
                },
                null,
                2,
              ),
            )
          }
        >
          读取测量
        </Button>
      </div>
      <section
        className="ai-panel"
        style={{
          width: "min(100%, 700px)",
          minWidth: 250,
          height: "75vh",
          resize: "horizontal",
          overflow: "hidden",
          border: "1px solid var(--border)",
          marginTop: 16,
        }}
      >
        <ScrollArea className="chat-scroll" viewportRef={scroll.viewportRef}>
          <div ref={scroll.contentRef} className="chat-messages">
            <Profiler
              id="markdown-preview"
              onRender={(_, __, duration) => {
                metrics.current.commits++;
                metrics.current.reactMs += duration;
                if (
                  metrics.current.terminalAt &&
                  !metrics.current.terminalCommitMs
                )
                  metrics.current.terminalCommitMs =
                    performance.now() - metrics.current.terminalAt;
              }}
            >
              <MessageMarkdown
                key={run}
                content={raw}
                generating={running}
                animated={animated}
              />
            </Profiler>
            <div className="chat-status">{running ? "生成中" : "已停止"}</div>
          </div>
        </ScrollArea>
        {!scroll.following && (
          <Button className="chat-follow" onClick={scroll.bottom}>
            回到底部
          </Button>
        )}
      </section>
      <pre style={{ whiteSpace: "pre-wrap" }}>{report}</pre>
    </main>
  );
}
