import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleCheck,
  CircleHelp,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { ProviderIdentity } from "./ProviderIdentity";
import { api } from "@reader/api";
import type { Provider, AIConfig } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@reader/ui/components/dialog";
import { Badge } from "@reader/ui/components/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";
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
  const [config, setConfig] = useState<AIConfig>();
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const checked = useRef(new Set<string>());
  const refreshing = useRef(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, setTheme } = useReaderStore();
  const refresh = async (force = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      const [providers, config] = await Promise.all([
        api.providers(),
        api.aiConfig(),
      ]);
      setProviders(providers);
      setConfig(config);
      const pending = providers.filter((provider) => {
        if (!provider.installed) return false;
        const key = JSON.stringify([
          provider.id,
          provider.authenticated,
          config.models[provider.id],
        ]);
        if (!force && checked.current.has(key)) return false;
        checked.current.add(key);
        return true;
      });
      setTesting(new Set(pending.map((provider) => provider.id)));
      setErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([id]) => !pending.some((provider) => provider.id === id),
          ),
        ),
      );
      setLoading(false);
      await Promise.all(
        pending.map(async ({ id }) => {
          try {
            const capability = await api.testAI(id);
            setConfig(
              (current) =>
                current && {
                  ...current,
                  capabilities: { ...current.capabilities, [id]: capability },
                },
            );
          } catch (error) {
            setErrors((current) => ({
              ...current,
              [id]: (error as Error).message,
            }));
          } finally {
            setTesting((current) => {
              const next = new Set(current);
              next.delete(id);
              return next;
            });
          }
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription className="sr-only">
            外观与 AI 连接
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-3">
          <section>
            <h3 className="mb-3 text-sm font-medium">界面主题</h3>
            <div className="flex gap-2">
              {(["light", "dark", "system"] as const).map((mode, i) => (
                <Button
                  key={mode}
                  aria-pressed={(theme.appearance ?? "system") === mode}
                  variant={
                    (theme.appearance ?? "system") === mode
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    setTheme({
                      appearance: mode,
                      mode: mode === "dark" ? "dark" : "light",
                    })
                  }
                >
                  {["浅色", "深色", "跟随系统"][i]}
                  {(theme.appearance ?? "system") === mode && (
                    <Check className="size-3" />
                  )}
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
                size="icon-sm"
                aria-label="重新检测 Agent"
                title="重新检测 Agent"
                disabled={loading || testing.size > 0}
                onClick={() => void refresh(true)}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
              </Button>
            </div>
            {config && (
              <div className="mb-4 space-y-2">
                <label className="text-sm" id="primary-agent-label">
                  主 Agent · 自动图片解析使用此连接
                </label>
                <Select
                  value={config.primary || null}
                  disabled={saving || testing.size > 0}
                  onValueChange={async (value) => {
                    if (!value) return;
                    setSaving(true);
                    try {
                      setConfig(
                        await api.saveAIConfig({ ...config, primary: value }),
                      );
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <SelectTrigger
                    aria-labelledby="primary-agent-label"
                    className="w-full"
                  >
                    <SelectValue placeholder="请选择主 Agent">
                      {config.primary ? (
                        <ProviderIdentity provider={config.primary} />
                      ) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="codex">
                      <ProviderIdentity provider="codex" />
                    </SelectItem>
                    <SelectItem value="claude">
                      <ProviderIdentity provider="claude" />
                    </SelectItem>
                    <SelectItem value="kimi">
                      <ProviderIdentity provider="kimi" />
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  图片能力检测通过后，导入的 PDF
                  将自动生成图表解析稿；图片会发送给此 Agent。
                </p>
              </div>
            )}
            <div className="space-y-3">
              {(["codex", "claude", "kimi"] as const).map((name) => {
                const p = providers.find((p) => p.id === name);
                const capability = config?.capabilities[name];
                const pending = loading || testing.has(name);
                const error = errors[name] || capability?.error;
                const passed = !error && capability?.text && capability?.vision;
                const state = pending
                  ? "pending"
                  : passed
                    ? "passed"
                    : "failed";
                return (
                  <div key={name} className="rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 text-sm font-medium">
                        <ProviderIdentity provider={name} />
                      </span>
                      {!loading && !p?.installed && (
                        <Badge variant="outline">未安装</Badge>
                      )}
                    </div>
                    {(pending || p?.installed) && (
                      <div
                        className="agent-check-status"
                        role="status"
                        aria-live="polite"
                        aria-label={`文本图片推理检测：${pending ? "检测中" : passed ? "已通过" : "未通过"}`}
                      >
                        <span
                          className="agent-check-icon"
                          key={state}
                          data-state={state}
                        >
                          {pending ? (
                            <LoaderCircle className="animate-spin" />
                          ) : passed ? (
                            <CircleCheck />
                          ) : (
                            <TriangleAlert />
                          )}
                        </span>
                        <span>文本图片推理检测</span>
                      </div>
                    )}
                    {!pending && p?.installed && !passed && (
                      <p className="mt-2 text-xs leading-5 text-muted-foreground break-words">
                        {error ||
                          (capability?.text
                            ? "文本可用，图片能力未通过检测。"
                            : "检测未通过，请确认 Agent 已完成登录。")}
                      </p>
                    )}
                    {!pending &&
                      p?.installed &&
                      !p.authenticated &&
                      !capability?.text && (
                        <p className="mt-3 text-xs leading-6 text-muted-foreground">
                          在终端运行{" "}
                          <code>
                            {name === "codex"
                              ? "codex login"
                              : name === "claude"
                                ? "claude auth login"
                                : "kimi login"}
                          </code>{" "}
                          完成官方登录，然后重新检测。
                        </p>
                      )}
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
