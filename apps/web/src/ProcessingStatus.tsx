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
  const settled = job.settling
    ? job.settling.status === "complete"
    : job.phase === "translating" || job.phase === "ready";
  const translated = job.translating
    ? job.translating.status === "complete"
    : job.phase === "ready";
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
      active: job.settling
        ? job.settling.status === "running"
        : job.phase === "settling" && job.status === "running",
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
      label: translated ? "翻译完成" : "翻译中",
      icon: Languages,
      done: translated,
      active: job.translating
        ? job.translating.status === "running"
        : job.phase === "translating" && job.status === "running",
      value: translated
        ? 100
        : job.translationsTotal
          ? Math.min(100, (job.translationsDone / job.translationsTotal) * 100)
          : 0,
      count: learned
        ? `${job.translationsDone} / ${job.translationsTotal} 段`
        : "等待解析完成",
    },
  ];
}
// Learning advances to one parallel-processing panel; hide it only after both
// jobs finish, rather than treating a change of active lane as completion.
function coverPhase(job: Processing) {
  return job.phase === "learning"
    ? "learning"
    : job.phase === "ready"
      ? "ready"
      : "processing";
}
function stageLabel(label: string, status: Processing["status"]) {
  const name = label.startsWith("沉淀")
    ? "沉淀"
    : label.startsWith("翻译")
      ? "翻译"
      : "学习";
  if (status === "queued") return `等待${name}`;
  if (status === "waiting") return `${name}待配置`;
  if (status === "failed") return `${name}失败`;
  return label;
}
export function CoverProcessing({
  job,
  onSettings,
  unavailable = false,
}: {
  job: Processing;
  onSettings: () => void;
  unavailable?: boolean;
}) {
  const nextPhase = coverPhase(job);
  const [phase, setPhase] = useState(nextPhase);
  const [retrying, setRetrying] = useState(false);
  const leaving = phase !== nextPhase;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setPhase(nextPhase), 750);
    return () => clearTimeout(timer);
  }, [leaving, nextPhase]);
  if (phase === "ready")
    return job.incomplete ? (
      <span className="cover-incomplete" title={job.warning || job.detail}>
        正文不完整
      </span>
    ) : null;
  const stages = processingStages(job).filter((stage) => {
    if (phase === "learning") return stage.key === "learning";
    if (stage.key === "learning") return false;
    if (
      stage.done &&
      (stage.key === "settling" ? job.assetsTotal : job.translationsTotal) === 0
    )
      return false;
    return true;
  });
  if (phase !== "learning") stages.reverse();
  const status = (key: string, done: boolean): Processing["status"] => {
    if (done) return "complete";
    if (key === "settling" && job.settling) return job.settling.status;
    if (key === "translating" && job.translating) return job.translating.status;
    return key === job.phase ? job.status : "queued";
  };
  const retry = async () => {
    setRetrying(true);
    try {
      await api.process(job.documentId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div
      className="cover-processing"
      key={phase}
      data-compact={phase !== "learning"}
      data-leaving={leaving}
      title={
        unavailable
          ? "暂时无法同步进度"
          : [
              job.detail,
              job.warning,
              job.settling?.detail,
              job.translating?.detail,
              job.settling?.warning,
              job.translating?.warning,
            ]
              .filter(Boolean)
              .join("\n")
      }
    >
      {stages.map((stage) => {
        const state = status(stage.key, stage.done);
        const label = stageLabel(stage.label, state);
        const count =
          stage.key === "learning"
            ? stage.value === null
              ? ""
              : `${Math.floor(stage.value)}%`
            : stage.key === "settling"
              ? `${job.assetsDone}/${job.assetsTotal}`
              : `${job.translationsDone}/${job.translationsTotal}`;
        return (
          <div
            key={stage.key}
            className="processing-step"
            data-stage={stage.key}
            data-active={!unavailable && !leaving && stage.active}
            data-done={stage.done || undefined}
            title={
              stage.key === "settling"
                ? job.settling?.detail
                : stage.key === "translating"
                  ? job.translating?.detail
                  : job.detail
            }
          >
            <div className="processing-step-heading" role="status">
              {stage.done && <Check className="size-3" />}
              {phase !== "learning" &&
              !leaving &&
              (state === "waiting" || state === "failed") ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="cover-processing-action"
                  aria-label={
                    state === "waiting"
                      ? "等待 AI 配置"
                      : `重试${stage.key === "settling" ? "沉淀" : "翻译"}`
                  }
                  disabled={state === "failed" && (retrying || unavailable)}
                  onClick={state === "waiting" ? onSettings : retry}
                >
                  {state === "failed" && <RefreshCw className="size-3" />}
                  <span className="processing-label">{label}</span>
                </Button>
              ) : (
                <span className="processing-label">{label}</span>
              )}
              <span className="processing-count">
                {unavailable ? "离线" : count}
              </span>
            </div>
            {phase === "learning" && (
              <Progress
                aria-label={label}
                value={stage.value ?? (stage.active && !unavailable ? null : 0)}
                className="processing-progress"
              />
            )}
            {phase === "learning" && !leaving && state === "waiting" && (
              <Button
                size="xs"
                variant="ghost"
                className="cover-processing-action"
                onClick={onSettings}
              >
                等待 AI 配置
              </Button>
            )}
            {phase === "learning" && !leaving && state === "failed" && (
              <Button
                size="xs"
                variant="ghost"
                className="cover-processing-action"
                disabled={retrying || unavailable}
                onClick={retry}
              >
                <RefreshCw className="size-3" />
                重试
                {stage.key === "settling"
                  ? "沉淀"
                  : stage.key === "translating"
                    ? "翻译"
                    : "学习"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
