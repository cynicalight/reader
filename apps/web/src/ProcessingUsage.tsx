import { useEffect, useState } from "react";
import type {
  Document,
  Processing,
  ProcessingUsage,
  TokenCounts,
} from "@reader/core";
import { api } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";

const labels: Record<string, string> = {
  learning: "学习／解析",
  settling: "沉淀／图片解析",
  translating: "正文翻译",
};
const statuses: Record<string, string> = {
  running: "进行中",
  complete: "完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
const providers: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  kimi: "Kimi Code",
  "text-api": "文字 API",
  "image-api": "图片 API",
};
const count = (value: number) => value.toLocaleString("zh-CN");
export function usageDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function sumOptional(a: number | null, b: number | null) {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}
function detail(value: number | null) {
  return value === null ? "未返回" : count(value);
}
function add(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cachedInputTokens: sumOptional(a.cachedInputTokens, b.cachedInputTokens),
    cacheWriteInputTokens: sumOptional(
      a.cacheWriteInputTokens,
      b.cacheWriteInputTokens,
    ),
    reasoningOutputTokens: sumOptional(
      a.reasoningOutputTokens,
      b.reasoningOutputTokens,
    ),
  };
}
const zero: TokenCounts = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: null,
  cacheWriteInputTokens: null,
  reasoningOutputTokens: null,
};
export function UsageDetails({ report }: { report: ProcessingUsage }) {
  const known = report.calls.some((call) =>
    call.models.some((model) => model.tokens !== null),
  );
  return (
    <div className="processing-usage">
      <dl className="usage-totals">
        <div>
          <dt>已记录总量</dt>
          <dd>
            {known
              ? `${count(report.total.totalTokens)} tokens`
              : report.calls.length
                ? "用量未知"
                : "暂无记录"}
          </dd>
        </div>
        <div>
          <dt>输入</dt>
          <dd>{known ? count(report.total.inputTokens) : "—"}</dd>
        </div>
        <div>
          <dt>输出</dt>
          <dd>{known ? count(report.total.outputTokens) : "—"}</dd>
        </div>
        <div>
          <dt>总经过时间</dt>
          <dd>
            {report.elapsedMs ? usageDuration(report.elapsedMs) : "未记录"}
          </dd>
        </div>
      </dl>
      {!report.historyComplete && (
        <p className="usage-note">历史用量未记录；仅统计启用功能后的调用。</p>
      )}
      {!!report.unknownCalls && (
        <p className="usage-note">
          {report.unknownCalls} 次调用未返回用量，总量可能不完整。
        </p>
      )}
      {!!report.partialCalls && (
        <p className="usage-note">
          {report.partialCalls}{" "}
          次未完成调用返回了部分用量，已计入；实际消耗可能更高。
        </p>
      )}
      <div className="usage-table-scroll">
        <table className="usage-table">
          <caption className="sr-only">各阶段与模型的 token 用量</caption>
          <thead>
            <tr>
              <th>阶段／模型</th>
              <th>输入</th>
              <th>输出</th>
              <th>总量</th>
            </tr>
          </thead>
          <tbody>
            {report.stages.map((stage) => {
              const groups = report.groups.filter(
                (g) => g.stage === stage.stage,
              );
              const tokens = groups.reduce(
                (sum, group) => add(sum, group.tokens),
                zero,
              );
              const stageKnown = report.calls.some(
                (c) =>
                  c.stage === stage.stage &&
                  c.models.some((m) => m.tokens !== null),
              );
              return (
                <StageRows
                  key={stage.stage}
                  label={labels[stage.stage]}
                  duration={stage.durationMs}
                  tokens={tokens}
                  groups={groups}
                  known={stageKnown}
                  local={stage.stage === "learning"}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="usage-note">
        调用 {report.calls.length} 次 · 未成功 {report.failedCalls}{" "}
        次。总量包含失败、重试及备用连接调用。
      </p>
      {known && (
        <p className="usage-note">
          缓存读取 {detail(report.total.cachedInputTokens)} · 缓存写入{" "}
          {detail(report.total.cacheWriteInputTokens)} · 推理{" "}
          {detail(report.total.reasoningOutputTokens)}
          。细分项仅在服务返回时记录，包含于输入或输出，不重复计入总量。
        </p>
      )}
      <details className="usage-calls">
        <summary>调用明细</summary>
        {report.calls.length === 0 ? (
          <p className="usage-note">暂无已记录的 AI 调用。</p>
        ) : (
          report.calls.map((call) => (
            <div className="usage-call" key={call.id}>
              <p>
                {labels[call.stage]} · {call.target}{" "}
                <span>{statuses[call.status] || call.status}</span>
              </p>
              {call.models.map((model, i) => (
                <p className="usage-note" key={`${model.model}-${i}`}>
                  {providers[call.provider] || call.provider} ·{" "}
                  {model.model || "模型未返回"} ·{" "}
                  {model.tokens
                    ? `${count(model.tokens.totalTokens)} tokens`
                    : "用量未知"}
                </p>
              ))}
              <p className="usage-note">
                {new Date(call.startedAt).toLocaleString("zh-CN")}
                {call.finishedAt
                  ? ` · ${usageDuration(new Date(call.finishedAt).getTime() - new Date(call.startedAt).getTime())}`
                  : " · 结束时间未记录"}
              </p>
            </div>
          ))
        )}
      </details>
    </div>
  );
}
function StageRows({
  label,
  duration,
  tokens,
  groups,
  known,
  local,
}: {
  label: string;
  duration: number;
  tokens: TokenCounts;
  groups: ProcessingUsage["groups"];
  known: boolean;
  local: boolean;
}) {
  return (
    <>
      <tr className="usage-stage">
        <th scope="row">
          {label}
          <small>
            {usageDuration(duration)}
            {local ? " · 本地处理" : ""}
          </small>
        </th>
        <td>{known ? count(tokens.inputTokens) : "—"}</td>
        <td>{known ? count(tokens.outputTokens) : "—"}</td>
        <td>
          {known ? count(tokens.totalTokens) : local ? "不涉及 AI" : "未记录"}
        </td>
      </tr>
      {groups.map((group) => (
        <tr key={`${group.provider}:${group.model}`}>
          <th scope="row">
            {group.model || "模型未返回"}
            <small>
              {providers[group.provider] || group.provider} · {group.calls} 次
              {group.unknownCalls ? ` · ${group.unknownCalls} 次用量未知` : ""}
            </small>
          </th>
          <td>
            {group.calls > group.unknownCalls
              ? count(group.tokens.inputTokens)
              : "—"}
          </td>
          <td>
            {group.calls > group.unknownCalls
              ? count(group.tokens.outputTokens)
              : "—"}
          </td>
          <td>
            {group.calls > group.unknownCalls
              ? count(group.tokens.totalTokens)
              : "未知"}
          </td>
        </tr>
      ))}
    </>
  );
}
export function ProcessingUsageDialog({
  document,
  job,
  onClose,
}: {
  document: Document | null;
  job?: Processing;
  onClose: () => void;
}) {
  const [report, setReport] = useState<ProcessingUsage | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const documentId = document?.id;
  useEffect(() => {
    setReport(null);
    setError("");
  }, [documentId]);
  useEffect(() => {
    if (!documentId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.processingUsage(documentId);
        if (!stopped) {
          setReport(next);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped && job?.status === "running")
        timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [documentId, job?.updatedAt, job?.status, retry]);
  return (
    <Dialog
      open={!!document}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="usage-dialog">
        <DialogHeader>
          <DialogTitle>处理统计</DialogTitle>
          <DialogDescription>{document?.title}</DialogDescription>
        </DialogHeader>
        {error && (
          <div role="alert">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetry((value) => value + 1)}
            >
              重新加载
            </Button>
          </div>
        )}
        {report ? (
          <UsageDetails report={report} />
        ) : (
          !error && <p role="status">正在读取统计…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
