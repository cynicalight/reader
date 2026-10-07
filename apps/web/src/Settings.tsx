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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@reader/ui/components/tooltip";
import { Checkbox } from "@reader/ui/components/checkbox";
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
  const [testing, setTesting] = useState<Map<string, "text" | "vision">>(
    new Map(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const checked = useRef(new Set<string>());
  const refreshing = useRef(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const {
    theme,
    setTheme,
    aiConfig: config,
    setAIConfig,
    aiModelSaving,
  } = useReaderStore();
  const refresh = async (force = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      const [providers, config] = await Promise.all([
        api.providers(false),
        api.aiConfig(),
      ]);
      setProviders(providers);
      setAIConfig(config);
      const pending = providers.filter((provider) => {
        if (!provider.installed) return false;
        // Saved results survive dialog remounts and application restarts.
        // Only an explicit retry replaces an existing result, including failures.
        if (
          !force &&
          config.capabilities[provider.id] &&
          !config.capabilities[provider.id].pendingVision
        )
          return false;
        const key = JSON.stringify([provider.id, config.models[provider.id]]);
        if (!force && checked.current.has(key)) return false;
        checked.current.add(key);
        return true;
      });
      const firstStage = (id: string): "text" | "vision" =>
        !force && config.capabilities[id]?.pendingVision ? "vision" : "text";
      setTesting(new Map(pending.map(({ id }) => [id, firstStage(id)])));
      setErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([key]) =>
              !pending.some((provider) => key.startsWith(`${provider.id}:`)),
          ),
        ),
      );
      setLoading(false);
      await Promise.all(
        pending.map(async ({ id }) => {
          let stage = firstStage(id);
          const update = (
            capability: NonNullable<typeof config>["capabilities"][string],
          ) => {
            const current = useReaderStore.getState().aiConfig;
            if (!current || current.models[id] !== config.models[id])
              return false;
            setAIConfig({
              ...current,
              capabilities: { ...current.capabilities, [id]: capability },
            });
            return true;
          };
          try {
            if (stage === "text") {
              const capability = await api.testAI(id, "text");
              if (!update(capability) || !capability.text) return;
              stage = "vision";
              setTesting((current) => new Map(current).set(id, "vision"));
            }
            const capability = await api.testAI(id, "vision");
            update(capability);
          } catch (error) {
            setErrors((current) => ({
              ...current,
              [`${id}:${stage}`]: (error as Error).message,
            }));
          } finally {
            setTesting((current) => {
              const next = new Map(current);
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
          <section className="space-y-2">
            <label className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={theme.autoTranslatePDF ?? true}
                onCheckedChange={(checked) =>
                  setTheme({ autoTranslatePDF: checked })
                }
                aria-label="导入后自动翻译"
              />
              导入后自动翻译
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              开启后，新导入的 PDF 会自动翻译全文并解析图表。
            </p>
          </section>
          <Separator />
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-medium">Agent 连接</h3>
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
              <div className="mb-4 flex flex-col gap-2">
                <label className="text-sm" id="primary-agent-label">
                  Agent SDK
                </label>
                <Select
                  value={config.primary || null}
                  disabled={saving || aiModelSaving || testing.size > 0}
                  onValueChange={async (value) => {
                    if (!value) return;
                    setSaving(true);
                    try {
                      const latest = await api.aiConfig();
                      const saved = await api.saveAIConfig({
                        ...latest,
                        primary: value,
                      });
                      setAIConfig(saved);
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
                    <SelectValue placeholder="请选择 Agent SDK">
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
                  对话使用此 SDK，具体模型在对话框中选择。开始翻译后，PDF
                  中的图片会发送给此 Agent 进行解析。
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              {(["codex", "claude", "kimi"] as const).map((name) => {
                const p = providers.find((p) => p.id === name);
                const capability = config?.capabilities[name];
                const pending = testing.has(name);

                return (
                  <div key={name} className="min-w-0 rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 text-base font-medium">
                        <ProviderIdentity provider={name} size={36} />
                      </span>
                      {!loading && !p?.installed && (
                        <Badge variant="outline">未安装</Badge>
                      )}
                    </div>
                    {(pending || p?.installed || capability) && (
                      <div className="flex flex-wrap gap-x-5">
                        {(
                          [
                            ["text", "文本推理"],
                            ["vision", "图片理解"],
                          ] as const
                        ).map(([kind, label]) => {
                          const stage = testing.get(name);
                          const pending =
                            stage === "text" ||
                            (stage === "vision" && kind === "vision");
                          const error =
                            errors[`${name}:${kind}`] || capability?.error;
                          const ready =
                            !errors[`${name}:text`] &&
                            !errors[`${name}:${kind}`] &&
                            !!capability?.[kind];
                          const state = pending
                            ? "pending"
                            : ready
                              ? "passed"
                              : "failed";
                          return (
                            <div
                              key={kind}
                              className="agent-check-status"
                              role="status"
                              aria-live="polite"
                              aria-label={`${label}：${pending ? "检测中" : ready ? "已通过" : "未通过"}`}
                            >
                              <span
                                className="agent-check-icon"
                                key={state}
                                data-state={state}
                              >
                                {pending ? (
                                  <LoaderCircle className="animate-spin" />
                                ) : ready ? (
                                  <CircleCheck />
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <Button variant="ghost" size="icon" />
                                      }
                                      className="size-4 p-0 text-inherit hover:bg-transparent hover:text-inherit"
                                      aria-label={`${label}未通过：查看详情`}
                                    >
                                      <TriangleAlert />
                                    </TooltipTrigger>
                                    <TooltipContent className="block max-w-xs space-y-2 leading-5 break-words">
                                      <p>
                                        {error ||
                                          (capability?.text
                                            ? "文本推理可用，图片理解未通过检测。"
                                            : "检测未通过，请检查终端中的 Agent、API 配置、网络或额度。")}
                                      </p>
                                      {!capability?.text && (
                                        <p>
                                          支持 CLI 当前使用的订阅登录或 API Key
                                          配置；以实际调用结果为准。
                                        </p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </span>
                              <span>{label}</span>
                            </div>
                          );
                        })}
                      </div>
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
