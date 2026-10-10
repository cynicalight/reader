import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Bot,
  Check,
  CircleCheck,
  CircleHelp,
  Highlighter,
  Library,
  LoaderCircle,
  Monitor,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { ProviderIdentity } from "./ProviderIdentity";
import { TaskModels } from "./TaskModels";
import { APIAgentForm, APIModelForm } from "./APIAgentForm";
import { api } from "@reader/api";
import type {
  AICapability,
  AIConfig,
  AgentModel,
  APIConnection,
  LibraryMode,
  Provider,
} from "@reader/core";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@reader/ui/components/tabs";
import { HighlightColorsEditor } from "./HighlightColorsEditor";
import {
  primaryLibraryMode,
  updateLibraryPreferences,
  useReaderStore,
} from "./store";
import { libraryModes } from "./LibraryModeSwitcher";
import { Checkbox } from "@reader/ui/components/checkbox";
import { toast } from "sonner";
// Checks run automatically for this many API models; the rest on demand.
const autoAPIChecks = 12;
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
  const [apiModels, setAPIModels] = useState<AgentModel[]>([]);
  const [apiModelsError, setAPIModelsError] = useState("");
  const [apiDetails, setAPIDetails] = useState(false);
  useEffect(() => {
    if (!open) setAPIDetails(false);
  }, [open]);
  const {
    theme,
    setTheme,
    aiConfig: config,
    setAIConfig,
    aiModelSaving,
    libraryPreferences,
  } = useReaderStore();
  const paperPreferences =
    useReaderStore((s) => s.libraryPreferences.papers) || {};
  // Run the text check, then the vision check, for an agent or an API model
  // ("api:<model>"). A result is dropped if its configuration changed meanwhile.
  const check = async (
    id: string,
    first: "text" | "vision",
    snapshot: AIConfig,
  ) => {
    const model = id.startsWith("api:") ? id.slice(4) : undefined;
    const run = (stage: "text" | "vision") =>
      model ? api.testAI("api", stage, model) : api.testAI(id, stage);
    let stage = first;
    const update = (capability: AICapability) => {
      const current = useReaderStore.getState().aiConfig;
      if (
        !current ||
        (model
          ? current.api.url !== snapshot.api.url
          : current.models[id] !== snapshot.models[id])
      )
        return false;
      setAIConfig({
        ...current,
        capabilities: { ...current.capabilities, [id]: capability },
      });
      return true;
    };
    try {
      if (stage === "text") {
        const capability = await run("text");
        if (!update(capability) || !capability.text) return;
        stage = "vision";
        setTesting((current) => new Map(current).set(id, "vision"));
      }
      update(await run("vision"));
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
  };
  const checkAll = async (
    ids: string[],
    firstStage: (id: string) => "text" | "vision",
    snapshot: AIConfig,
  ) => {
    setTesting((current) => {
      const next = new Map(current);
      for (const id of ids) next.set(id, firstStage(id));
      return next;
    });
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !ids.some((id) => key.startsWith(`${id}:`)),
        ),
      ),
    );
    await Promise.all(ids.map((id) => check(id, firstStage(id), snapshot)));
  };
  const warnWithoutVision = (models: AgentModel[]) => {
    const capabilities = useReaderStore.getState().aiConfig?.capabilities;
    const results = models.map(({ id }) => capabilities?.[`api:${id}`]);
    if (
      results.length &&
      results.every(Boolean) &&
      !results.some((r) => r?.vision)
    )
      toast.warning(
        "此 API Key 不符合图片理解要求：拉取到的模型都没有通过图片理解检测。",
      );
  };
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
      // CLI agents are checked as a whole, the API agent one model at a time.
      const pending = providers
        .filter((provider) => {
          if (provider.id === "api" || !provider.installed) return false;
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
        })
        .map(({ id }) => id);
      let models: AgentModel[] = [];
      if (providers.some(({ id, installed }) => id === "api" && installed)) {
        try {
          models = await api.agentModels("api");
          setAPIModelsError("");
        } catch (error) {
          setAPIModelsError((error as Error).message);
        }
      }
      setAPIModels(models);
      // Large catalogs are checked on demand, row by row.
      const modelChecks = models
        .filter((model) => {
          const saved = config.capabilities[`api:${model.id}`];
          if (!force && saved && !saved.pendingVision) return false;
          return (
            force || !checked.current.has(JSON.stringify(["api", model.id]))
          );
        })
        .slice(0, autoAPIChecks);
      for (const model of modelChecks)
        checked.current.add(JSON.stringify(["api", model.id]));
      const firstStage = (id: string): "text" | "vision" =>
        !force && config.capabilities[id]?.pendingVision ? "vision" : "text";
      setLoading(false);
      await checkAll(
        [...pending, ...modelChecks.map(({ id }) => `api:${id}`)],
        firstStage,
        config,
      );
      if (modelChecks.length) warnWithoutVision(models);
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
  const checkModel = async (model: AgentModel) => {
    const snapshot = useReaderStore.getState().aiConfig;
    if (!snapshot) return;
    checked.current.add(JSON.stringify(["api", model.id]));
    await checkAll([`api:${model.id}`], () => "text", snapshot);
    warnWithoutVision(apiModels);
  };
  const saveConfig = async (change: (latest: AIConfig) => AIConfig) => {
    setSaving(true);
    try {
      setAIConfig(await api.saveAIConfig(change(await api.aiConfig())));
    } catch (e) {
      toast.error((e as Error).message);
      return;
    } finally {
      setSaving(false);
    }
    await refresh();
  };
  const saveAPI = (connection: APIConnection) => {
    // A new address or key is a new connection: test its models again.
    for (const key of checked.current)
      if (key.startsWith('["api"')) checked.current.delete(key);
    return saveConfig((latest) => ({ ...latest, api: connection }));
  };
  const saveAPIModels = (change: (models: string[]) => string[]) =>
    saveConfig((latest) => ({
      ...latest,
      apiModels: change(latest.apiModels ?? []),
    }));
  const checkStatus = (id: string, capability?: AICapability) => (
    <div className="flex flex-wrap gap-x-5">
      {(
        [
          ["text", "文本推理"],
          ["vision", "图片理解"],
        ] as const
      ).map(([kind, label]) => {
        const stage = testing.get(id);
        const pending =
          stage === "text" || (stage === "vision" && kind === "vision");
        const error = errors[`${id}:${kind}`] || capability?.error;
        const ready =
          !errors[`${id}:text`] &&
          !errors[`${id}:${kind}`] &&
          !!capability?.[kind];
        const state = pending ? "pending" : ready ? "passed" : "failed";
        const apiModel = id.startsWith("api:");
        return (
          <div
            key={kind}
            className="agent-check-status"
            role="status"
            aria-live="polite"
            aria-label={`${label}：${pending ? "检测中" : ready ? "已通过" : "未通过"}`}
          >
            <span className="agent-check-icon" key={state} data-state={state}>
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : ready ? (
                <CircleCheck />
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon" />}
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
                          : apiModel
                            ? "检测未通过，请检查 API 地址、Key、模型名称、网络或额度。"
                            : "检测未通过，请检查终端中的 Agent、API 配置、网络或额度。")}
                    </p>
                    {!capability?.text && !apiModel && (
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
  );
  const apiCardStatus = () => (
    <span className="flex flex-wrap gap-x-5">
      {(["text", "vision"] as const).map((kind) => {
        const label = kind === "text" ? "文本推理" : "图片理解";
        // The API agent uses a separate model for each task. One passing model
        // is enough for the corresponding capability on this summary card.
        const ready = apiModels.some((model) => {
          const id = `api:${model.id}`;
          return (
            !errors[`${id}:text`] &&
            !errors[`${id}:${kind}`] &&
            config?.capabilities[id]?.[kind]
          );
        });
        const pending =
          !ready &&
          (loading || [...testing.keys()].some((id) => id.startsWith("api:")));
        const state = pending ? "pending" : ready ? "passed" : "failed";
        return (
          <span
            key={kind}
            className="agent-check-status"
            role="status"
            aria-live="polite"
            aria-label={`${label}：${pending ? "检测中" : ready ? "已通过" : "未通过"}`}
          >
            <span className="agent-check-icon" data-state={state}>
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : ready ? (
                <CircleCheck />
              ) : (
                <TriangleAlert />
              )}
            </span>
            <span>{label}</span>
          </span>
        );
      })}
    </span>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog p-6 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {apiDetails ? (
              <Button
                variant="ghost"
                className="-ml-2 gap-1 px-2 text-base"
                onClick={() => setAPIDetails(false)}
                aria-label="返回 Agent 设置"
              >
                <ChevronLeft />
                API 配置
              </Button>
            ) : (
              "设置"
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Agent 连接、显示、阅读与论文库
          </DialogDescription>
        </DialogHeader>
        {apiDetails && (
          <div className="settings-panel">
            <section>
              {config && (
                <APIAgentForm
                  connection={config.api}
                  disabled={saving || testing.size > 0}
                  onSave={saveAPI}
                />
              )}
              {config &&
                providers.some((p) => p.id === "api" && p.installed) && (
                  <div className="mt-6">
                    <h3 className="mb-1 text-sm font-medium">模型</h3>
                    <ul className="api-model-list">
                      {apiModels.map((model) => {
                        const id = `api:${model.id}`;
                        const result = config.capabilities[id];
                        return (
                          <li
                            key={model.id}
                            className="flex min-h-9 items-center gap-3"
                          >
                            <span
                              className="min-w-0 flex-1 truncate text-sm"
                              title={model.id}
                            >
                              {model.name}
                            </span>
                            {testing.has(id) ||
                            result ||
                            errors[`${id}:text`] ? (
                              checkStatus(id, result)
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={saving}
                                onClick={() => void checkModel(model)}
                              >
                                检测
                              </Button>
                            )}
                            {model.custom && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`移除 ${model.name}`}
                                title="移除"
                                disabled={saving || testing.has(id)}
                                onClick={() =>
                                  void saveAPIModels((models) =>
                                    models.filter((item) => item !== model.id),
                                  )
                                }
                              >
                                <X />
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {apiModelsError && (
                      <p
                        className="mt-1 text-xs text-muted-foreground"
                        role="alert"
                      >
                        {apiModelsError}
                      </p>
                    )}
                    <APIModelForm
                      disabled={saving}
                      onAdd={(id) => saveAPIModels((models) => [...models, id])}
                    />
                  </div>
                )}
            </section>
          </div>
        )}
        <Tabs
          defaultValue="agent"
          className="settings-tabs"
          style={{ display: apiDetails ? "none" : undefined }}
        >
          <TabsList aria-label="设置分类" className="settings-nav">
            <TabsTrigger value="agent">
              <Bot />
              Agent
            </TabsTrigger>
            <TabsTrigger value="display">
              <Monitor />
              显示
            </TabsTrigger>
            <TabsTrigger value="reading">
              <Highlighter />
              阅读
            </TabsTrigger>
            <TabsTrigger value="papers">
              <Library />
              论文库
            </TabsTrigger>
          </TabsList>
          <TabsContent value="display" className="settings-panel" keepMounted>
            <section className="mb-6">
              <h3
                id="primary-library-label"
                className="mb-3 text-sm font-medium"
              >
                主要模式
              </h3>
              <Select
                value={primaryLibraryMode(libraryPreferences)}
                onValueChange={(value) => {
                  if (value !== "papers" && value !== "books") return;
                  void updateLibraryPreferences({ primaryMode: value }).catch(
                    (error) => toast.error((error as Error).message),
                  );
                }}
              >
                <SelectTrigger
                  aria-labelledby="primary-library-label"
                  className="w-48"
                >
                  <SelectValue>
                    {libraryModes[primaryLibraryMode(libraryPreferences)].label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(libraryModes) as LibraryMode[]).map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {libraryModes[mode].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                下次启动时默认进入此模式。
              </p>
            </section>
            <section>
              <h3 className="mb-3 text-sm font-medium">界面主题</h3>
              <div className="flex gap-2">
                {(["light", "sepia", "dark", "system"] as const).map(
                  (mode, i) => (
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
                          mode:
                            mode === "dark" || mode === "sepia"
                              ? mode
                              : "light",
                        })
                      }
                    >
                      {["浅色", "纸张", "深色", "跟随系统"][i]}
                      {(theme.appearance ?? "system") === mode && (
                        <Check className="size-3" />
                      )}
                    </Button>
                  ),
                )}
              </div>
            </section>
          </TabsContent>
          <TabsContent value="reading" className="settings-panel" keepMounted>
            <section className="mb-6">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={theme.linkTranslationAnnotations !== false}
                  onCheckedChange={(checked) =>
                    setTheme({ linkTranslationAnnotations: !!checked })
                  }
                />
                <span>
                  译文原文划线关联
                  <span className="block text-xs text-muted-foreground">
                    悬停与批注同步到另一侧对应的完整句子
                  </span>
                </span>
              </label>
            </section>
            <section>
              <h3 className="mb-3 text-sm font-medium">高亮颜色</h3>
              <HighlightColorsEditor />
            </section>
          </TabsContent>
          <TabsContent value="papers" className="settings-panel" keepMounted>
            <section>
              <h3 className="mb-3 text-sm font-medium">论文库</h3>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={paperPreferences.autoLookup !== false}
                  onCheckedChange={(checked) =>
                    void updateLibraryPreferences({
                      papers: { ...paperPreferences, autoLookup: !!checked },
                    }).catch((e) => toast.error(e.message))
                  }
                />
                <span>
                  导入 PDF 后自动补全论文信息
                  <span className="block text-xs text-muted-foreground">
                    只把文中的 DOI 或 arXiv 编号发送给 arXiv、Crossref 与
                    Semantic Scholar
                  </span>
                </span>
              </label>
              <label className="mt-4 flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={theme.autoTranslatePDF ?? true}
                  onCheckedChange={(checked) =>
                    setTheme({ autoTranslatePDF: !!checked })
                  }
                />
                <span>
                  导入后自动翻译
                  <span className="block text-xs text-muted-foreground">
                    开启后，新导入的论文会自动翻译全文。
                  </span>
                </span>
              </label>
            </section>
          </TabsContent>
          <TabsContent value="agent" className="settings-panel" keepMounted>
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
                      <SelectItem value="api">
                        <ProviderIdentity provider="api" />
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <TaskModels disabled={saving || testing.size > 0} />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {config.primary === "api"
                      ? "只列出通过检测的模型：问答与翻译需通过文本推理，图片需通过图片理解。公式转换与主动图片提问使用图片模型。"
                      : "问答与翻译分别使用上方模型；未指定时，问答使用主力模型，翻译使用快速模型。公式转换与主动图片提问会向此 Agent 发送图片。"}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                {(["codex", "claude", "kimi", "api"] as const).map((name) => {
                  const p = providers.find((p) => p.id === name);
                  const capability = config?.capabilities[name];
                  const pending = testing.has(name);

                  if (name === "api")
                    return (
                      <Button
                        key={name}
                        variant="outline"
                        className="h-auto min-h-28 min-w-0 flex-col items-stretch justify-start gap-0 rounded-xl border-border bg-transparent p-4 text-left font-normal whitespace-normal hover:bg-muted/50 dark:border-border dark:bg-transparent"
                        onClick={() => setAPIDetails(true)}
                        aria-label="配置 API Key"
                      >
                        <span className="flex w-full items-center gap-3">
                          <span className="flex-1 text-base font-medium">
                            <ProviderIdentity provider={name} size={36} />
                          </span>
                          {!loading && !p?.installed && (
                            <Badge variant="outline">未配置</Badge>
                          )}
                        </span>
                        {p?.installed ? (
                          apiCardStatus()
                        ) : (
                          <span className="mt-3 text-xs text-muted-foreground">
                            点击卡片配置你的apikey
                          </span>
                        )}
                      </Button>
                    );

                  return (
                    <div
                      key={name}
                      className="min-h-28 min-w-0 rounded-xl border p-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex-1 text-base font-medium">
                          <ProviderIdentity provider={name} size={36} />
                        </span>
                        {!loading && !p?.installed && (
                          <Badge variant="outline">未安装</Badge>
                        )}
                      </div>
                      {(pending || p?.installed || capability) &&
                        checkStatus(name, capability)}
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 flex gap-2 text-xs leading-5 text-muted-foreground">
                <CircleHelp className="mt-0.5 size-4 shrink-0" />
                Reader 调用已安装的 CLI，不读取账号凭据。AI 请求使用 CLI
                当前账户与计费方式；选择订阅登录时无需另填 API Key。API 连接使用
                OpenAI 兼容接口，Key 保存在本机 Reader
                数据目录。发送的选区或章节会交给对应服务。
              </p>
            </section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
