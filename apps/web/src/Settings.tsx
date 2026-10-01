import { useEffect, useState } from "react";
import { Check, CircleHelp, RefreshCw, Terminal } from "lucide-react";
import { api } from "@reader/api";
import type { Provider } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";
import { Badge } from "@reader/ui/components/badge";
import { Separator } from "@reader/ui/components/separator";
import { useReaderStore } from "./store";
import { toast } from "sonner";
export function Settings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const { theme, setTheme } = useReaderStore();
  const refresh = async () => {
    setLoading(true);
    try {
      setProviders(await api.providers());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>让 Reader 适合你</DialogTitle>
          <DialogDescription>
            阅读偏好和 AI 连接，保存在这台电脑上。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-3">
          <section>
            <h3 className="mb-3 text-sm font-medium">界面主题</h3>
            <div className="flex gap-2">
              {(["light", "sepia", "dark"] as const).map((mode, i) => (
                <Button
                  key={mode}
                  variant={theme.mode === mode ? "default" : "outline"}
                  onClick={() => setTheme({ mode })}
                >
                  {["浅色", "纸张", "深色"][i]}
                  {theme.mode === mode && <Check className="size-3" />}
                </Button>
              ))}
            </div>
          </section>
          <Separator />
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-medium">订阅账号连接</h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
                检测
              </Button>
            </div>
            <div className="space-y-3">
              {(["codex", "claude"] as const).map((name) => {
                const p = providers.find((p) => p.id === name);
                return (
                  <div key={name} className="rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                      <Terminal className="size-4 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">
                        {name === "codex" ? "Codex CLI" : "Claude Code"}
                      </span>
                      <Badge
                        variant={p?.authenticated ? "secondary" : "outline"}
                      >
                        {loading ? "检测中" : p?.status || "尚未检测"}
                      </Badge>
                    </div>
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      在终端运行{" "}
                      <code>
                        {name === "codex" ? "codex login" : "claude auth login"}
                      </code>{" "}
                      完成官方登录，然后重新检测。
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 flex gap-2 text-xs leading-5 text-muted-foreground">
              <CircleHelp className="mt-0.5 size-4 shrink-0" />
              Reader 调用已安装的 CLI，不读取账号凭据。AI 请求使用 CLI
              当前账户与计费方式；选择订阅登录时无需另填 API
              Key。发送的选区或章节会交给对应服务。
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
