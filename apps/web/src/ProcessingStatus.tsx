import { useEffect, useState } from "react";
import { Check, ScanLine, Sparkles, RefreshCw, Languages } from "lucide-react";
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
  const settled = job.phase === "translating" || job.phase === "ready";
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
      label: settled ? "沉淀完成" : "沉淀中",
      icon: Sparkles,
      done: settled,
      active: job.phase === "settling" && job.status === "running",
      value: settled
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
    {
      key: "translating",
      label: job.phase === "ready" ? "翻译完成" : "翻译中",
      icon: Languages,
      done: job.phase === "ready",
      active: job.phase === "translating" && job.status === "running",
      value:
        job.phase === "ready"
          ? 100
          : job.translationsTotal
            ? Math.min(
                100,
                (job.translationsDone / job.translationsTotal) * 100,
              )
            : 0,
      count: settled
        ? `${job.translationsDone} / ${job.translationsTotal} 段`
        : "等待解析完成",
    },
  ];
}
// Keep completion visible briefly, then lift it away before revealing the next stage.
export function CoverProcessing({
  job,
  onSettings,
  unavailable = false,
}: {
  job: Processing;
  onSettings: () => void;
  unavailable?: boolean;
}) {
  const [phase, setPhase] = useState(job.phase);
  const [retrying, setRetrying] = useState(false);
  const leaving = phase !== job.phase;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setPhase(job.phase), 750);
    return () => clearTimeout(timer);
  }, [leaving, job.phase]);
  if (job.status === "paused") return null;
  if (phase === "ready")
    return job.incomplete ? (
      <span className="cover-incomplete" title={job.warning || job.detail}>
        正文不完整
      </span>
    ) : null;
  const stage = processingStages(job).find((stage) => stage.key === phase)!;
  const label = stage.label;
  return (
    <div
      className="cover-processing"
      key={phase}
      data-leaving={leaving}
      title={
        unavailable
          ? "暂时无法同步进度"
          : [job.detail, job.warning].filter(Boolean).join("\n")
      }
    >
      <div
        className="processing-step"
        data-active={!unavailable && !leaving && stage.active}
      >
        <div className="processing-step-heading" role="status">
          {leaving ? <Check className="size-3" /> : null}
          <span>{label}</span>
          <span className="processing-count">
            {leaving
              ? "100%"
              : unavailable
                ? "离线"
                : stage.value === null
                  ? ""
                  : `${Math.floor(stage.value)}%`}
          </span>
        </div>
        <Progress
          aria-label={label}
          value={
            leaving
              ? 100
              : (stage.value ?? (stage.active && !unavailable ? null : 0))
          }
          className="processing-progress"
        />
      </div>
      {!leaving && job.status === "waiting" && (
        <Button
          size="xs"
          variant="ghost"
          className="cover-processing-action"
          onClick={onSettings}
        >
          等待 AI 配置
        </Button>
      )}
      {!leaving && job.status === "failed" && (
        <Button
          size="xs"
          variant="ghost"
          className="cover-processing-action"
          disabled={retrying || unavailable}
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
  );
}
