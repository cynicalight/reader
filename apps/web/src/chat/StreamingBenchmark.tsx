/** Development-only numerical probe. No UI/visual acceptance assertions. */
import { Profiler, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MessageMarkdown } from "./MessageMarkdown";
import { sizedFixture } from "./fixtures";
export default function StreamingBenchmark() {
  const params = new URLSearchParams(location.search);
  const bytes = Number(params.get("bytes")) || 10240;
  const animated = params.get("animated") === "true";
  const [content, setContent] = useState("");
  const [running, setRunning] = useState(true);
  const metrics = useRef({
    commits: 0,
    reactMs: 0,
    maxCommitMs: 0,
    longTasks: 0,
    longTaskMs: 0,
  });
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.current.longTasks++;
        metrics.current.longTaskMs += entry.duration;
      }
    });
    observer.observe({ type: "longtask" });
    const memory = () =>
      (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    void (async () => {
      await sleep(200);
      const source = sizedFixture(bytes),
        chunks = source.match(/[\s\S]{1,4096}/gu)!;
      const beforeHeap = memory(),
        start = performance.now();
      let received = "";
      for (const chunk of chunks) {
        if (!alive) return;
        received += chunk;
        flushSync(() => setContent(received));
        await sleep(20);
      }
      const terminalAt = performance.now();
      flushSync(() => setRunning(false));
      const terminalCommitMs = performance.now() - terminalAt;
      await new Promise(requestAnimationFrame);
      const terminalFrameMs = performance.now() - terminalAt;
      const afterHeap = memory();
      await sleep(1000);
      if (!alive) return;
      const commitsAtIdle = metrics.current.commits;
      await sleep(1000);
      const report = {
        bytes: new TextEncoder().encode(source).length,
        animated,
        chunks: chunks.length,
        intervalMs: 20,
        ...metrics.current,
        elapsedMs: performance.now() - start - 2000,
        terminalCommitMs,
        terminalFrameMs,
        beforeHeap,
        afterHeap,
        idleHeap: memory(),
        idleCommits: metrics.current.commits - commitsAtIdle,
        textLength: host.current?.textContent?.length,
        userAgent: navigator.userAgent,
      };
      console.log("READER_BENCHMARK=" + JSON.stringify(report));
      observer.disconnect();
    })();
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [bytes, animated]);
  return (
    <div ref={host} style={{ width: 360 }}>
      <Profiler
        id="benchmark"
        onRender={(_, __, duration) => {
          metrics.current.commits++;
          metrics.current.reactMs += duration;
          metrics.current.maxCommitMs = Math.max(
            metrics.current.maxCommitMs,
            duration,
          );
        }}
      >
        <MessageMarkdown
          content={content}
          generating={running}
          animated={animated}
        />
      </Profiler>
    </div>
  );
}
