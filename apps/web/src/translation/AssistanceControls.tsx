import { useEffect, useRef, useState } from "react";
import { Pause, Sparkles } from "lucide-react";
import type { Processing } from "@reader/core";
import { api } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import { toast } from "sonner";

export function AssistanceControls({
  documentId,
  processing,
}: {
  documentId: string;
  processing?: Processing;
}) {
  const [saved, setSaved] = useState<Processing>();
  const [busy, setBusy] = useState(false);
  const serial = useRef(0);
  const job =
    saved &&
    (!processing ||
      Date.parse(saved.updatedAt) > Date.parse(processing.updatedAt))
      ? saved
      : processing;
  useEffect(() => {
    let alive = true;
    setSaved(undefined);
    setBusy(false);
    void api
      .assistance(documentId)
      .then((p) => {
        if (alive) setSaved(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
      serial.current++;
    };
  }, [documentId]);
  const complete = job?.enabled && job.status === "complete";
  const action = job?.enabled ? "pause" : job?.startedAt ? "resume" : "start";
  return (
    <div className="assistance-controls">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !job || complete}
        title={job?.enabled ? job.detail : "使用当前 AI 连接翻译全文与公式"}
        onClick={async () => {
          const operation = ++serial.current;
          setBusy(true);
          try {
            const next = await api.setAssistance(documentId, action);
            if (operation === serial.current) setSaved(next);
          } catch (e) {
            if (operation === serial.current) toast.error((e as Error).message);
          } finally {
            if (operation === serial.current) setBusy(false);
          }
        }}
      >
        {job?.enabled && !complete ? <Pause /> : <Sparkles />}
        {complete
          ? "翻译完成"
          : job?.enabled
            ? "暂停翻译"
            : job?.startedAt
              ? "继续翻译"
              : "开始翻译"}
      </Button>
    </div>
  );
}
