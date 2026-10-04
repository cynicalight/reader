import { useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  ScanLine,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import type { Processing } from "@reader/core";
import { api } from "@reader/api";
import { Progress } from "@reader/ui/components/progress";
import { Button } from "@reader/ui/components/button";
import { toast } from "sonner";

export function useProcessing() {
  const [jobs, setJobs] = useState<Processing[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.processing();
        if (!stopped) {
          setJobs(next);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        if (!stopped) timer = setTimeout(poll, 1200);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return { jobs, error };
}
export function processingStages(job: Processing) {
  const learned = job.phase !== "learning";
  return [
    {
      key: "learning",
      label: learned
        ? job.incomplete
          ? "学习部分完成"
          : "学习完成"
        : "学习中",
      icon: ScanLine,
      done: learned,
      active: !learned && job.status === "running",
      value: learned
        ? 100
        : job.pagesTotal
          ? Math.min(100, (job.pagesDone / job.pagesTotal) * 100)
          : null,
      count: job.pagesTotal
        ? `${job.pagesDone} / ${job.pagesTotal} 页`
        : "解析正文与版面",
    },
    {
      key: "settling",
      label: job.phase === "ready" ? "沉淀完成" : "沉淀中",
      icon: Sparkles,
      done: job.phase === "ready",
      active: job.phase === "settling" && job.status === "running",
      value:
        job.phase === "ready"
          ? 100
          : job.assetsTotal
            ? Math.min(100, (job.assetsDone / job.assetsTotal) * 100)
            : 0,
      count: learned
        ? job.assetsTotal
          ? `${job.assetsDone} / ${job.assetsTotal} 个附件`
          : "无需解析图片"
        : "等待学习完成",
    },
  ];
}
export function ProcessingStatus({
  job,
  onSettings,
  compact = false,
}: {
  job: Processing;
  onSettings: () => void;
  compact?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <section
      className={`processing-card ${compact ? "processing-compact" : ""}`}
      aria-label="文档处理进度"
    >
      <div className="processing-stages">
        {processingStages(job).map((stage) => (
          <div
            key={stage.key}
            className="processing-step"
            data-active={stage.active}
            data-done={stage.done}
          >
            <div className="processing-step-heading">
              {stage.done && job.incomplete && stage.key === "learning" ? (
                <CircleAlert className="size-3.5 text-amber-600" />
              ) : stage.done ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <stage.icon className="size-3.5" />
              )}
              <span>{stage.label}</span>
              <span className="processing-count">{stage.count}</span>
            </div>
            <Progress
              aria-label={stage.label}
              value={stage.active ? stage.value : (stage.value ?? 0)}
              className="processing-progress"
            />
          </div>
        ))}
      </div>
      <div className="processing-detail" role="status">
        {(job.status === "failed" || job.status === "waiting") && (
          <CircleAlert className="size-3.5 shrink-0" />
        )}
        <span>{job.detail}</span>
        {job.status === "waiting" && (
          <Button size="xs" variant="ghost" onClick={onSettings}>
            配置 AI
          </Button>
        )}
        {job.status === "failed" && (
          <Button
            size="xs"
            variant="ghost"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await api.process(job.documentId);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setRetrying(false);
              }
            }}
          >
            <RefreshCw className="size-3" />
            重试
          </Button>
        )}
      </div>
      {job.warning && <p className="processing-warning">{job.warning}</p>}
    </section>
  );
}
