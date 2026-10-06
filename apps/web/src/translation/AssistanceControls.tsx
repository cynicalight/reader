import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pause, Sparkles } from "lucide-react";
import type { Processing } from "@reader/core";
import { api } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@reader/ui/components/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@reader/ui/components/dialog";
import { toast } from "sonner";

export function AssistanceControls({
  documentId,
  page,
  totalPages,
  processing,
}: {
  documentId: string;
  page: number;
  totalPages?: number;
  processing?: Processing;
}) {
  const [saved, setSaved] = useState<Processing>();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [connection, setConnection] = useState("");
  const serial = useRef(0);
  const followAttempt = useRef<string | undefined>(undefined);
  const job =
    saved && (!processing || saved.updatedAt >= processing.updatedAt)
      ? saved
      : processing;
  useEffect(() => {
    let alive = true;
    setSaved(undefined);
    setBusy(false);
    followAttempt.current = undefined;
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
  const update = async (
    action: "reading" | "full" | "pause" | "follow" | "resume",
  ) => {
    const operation = ++serial.current;
    if (action !== "follow") followAttempt.current = undefined;
    setBusy(true);
    try {
      const next = await api.setAssistance(documentId, action, page);
      if (operation === serial.current) setSaved(next);
    } catch (e) {
      if (operation === serial.current) toast.error((e as Error).message);
    } finally {
      if (operation === serial.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (
      !job?.enabled ||
      job.mode !== "reading" ||
      job.pageStart === page ||
      followAttempt.current === `${documentId}:${page}` ||
      busy
    )
      return;
    const timer = setTimeout(() => {
      followAttempt.current = `${documentId}:${page}`;
      void update("follow");
    }, 600);
    return () => clearTimeout(timer);
  }, [documentId, page, job?.enabled, job?.mode, job?.pageStart, busy]);
  const openFull = () => {
    setMenu(false);
    setConfirm(true);
    setConnection("");
    void api
      .aiConfig()
      .then((config) => setConnection(config.primary || "尚未配置"))
      .catch(() => setConnection("尚未配置"));
  };
  const label = job?.enabled
    ? "暂停辅助阅读"
    : job?.mode === "full"
      ? "继续整本处理"
      : "开启辅助阅读";
  return (
    <div className="assistance-controls">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        title={
          job?.enabled
            ? job.detail
            : "随阅读解析图表并翻译正文，使用当前 AI 连接"
        }
        onClick={() =>
          void update(
            job?.enabled
              ? "pause"
              : job?.mode === "full"
                ? "resume"
                : "reading",
          )
        }
      >
        {job?.enabled ? <Pause /> : <Sparkles />}
        {label}
      </Button>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="辅助阅读选项"
              disabled={busy}
            />
          }
        >
          <MoreHorizontal />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-1">
          {job?.mode === "full" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMenu(false);
                void update("reading");
              }}
            >
              随阅读处理
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={openFull}>
            处理整本…
          </Button>
        </PopoverContent>
      </Popover>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>处理整本 PDF</DialogTitle>
            <DialogDescription>
              将解析{totalPages ? `全部 ${totalPages} 页` : "所有页面"}
              、理解图表并翻译正文。使用
              {connection ? ` ${connection} ` : "当前 "}AI
              连接，可能产生较多调用。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                void update("full");
              }}
            >
              开始处理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
