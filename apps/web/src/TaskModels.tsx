import { useEffect, useState } from "react";
import { api } from "@reader/api";
import type {
  AIConfig,
  AgentModel,
  ModelTask,
  ReasoningEffort,
} from "@reader/core";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";
import { toast } from "sonner";
import {
  effortLabel,
  efforts,
  modelDisplayName,
  selectedAgentModel,
} from "./ModelSelector";
import { useReaderStore } from "./store";

const AUTO = "__auto__";
const tasks: [ModelTask, string][] = [
  ["chat", "问答"],
  ["translation", "翻译"],
];
const fields = {
  chat: { models: "models", efforts: "efforts" },
  translation: { models: "translationModels", efforts: "translationEfforts" },
} as const;

export function taskChoice(config: AIConfig, task: ModelTask) {
  const provider = config.primary;
  const model = config[fields[task].models]?.[provider] ?? "";
  const effort = config[fields[task].efforts]?.[provider]?.[model] ?? "medium";
  return { model, effort };
}

export function TaskModels({ disabled }: { disabled: boolean }) {
  const {
    aiConfig: config,
    setAIConfig,
    aiModelSaving: saving,
    setAIModelSaving,
  } = useReaderStore();
  const provider = config?.primary ?? "";
  const [catalog, setCatalog] = useState<{
    provider: string;
    models: AgentModel[];
  }>({ provider: "", models: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api
      .agentModels(provider, controller.signal)
      .then((models) => {
        if (!controller.signal.aborted)
          setCatalog({
            provider,
            models: models.map((model) => ({
              ...model,
              name: modelDisplayName(model.id, model.name),
            })),
          });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider]);
  if (!config || !provider) return null;
  const models = catalog.provider === provider ? catalog.models : [];

  const save = async (change: (latest: AIConfig) => AIConfig) => {
    if (useReaderStore.getState().aiModelSaving) return;
    setAIModelSaving(true);
    try {
      const latest = await api.aiConfig();
      if (latest.primary !== provider) {
        setAIConfig(latest);
        throw new Error("Agent SDK 已改变，请重新选择模型");
      }
      setAIConfig(await api.saveAIConfig(change(latest)));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAIModelSaving(false);
    }
  };
  const chooseModel = (task: ModelTask, value: string) =>
    save((latest) => {
      const key = fields[task].models;
      return {
        ...latest,
        [key]: { ...latest[key], [provider]: value === AUTO ? "" : value },
      };
    });
  const chooseEffort = (
    task: ModelTask,
    model: string,
    value: ReasoningEffort,
  ) =>
    save((latest) => {
      if ((latest[fields[task].models]?.[provider] ?? "") !== model)
        throw new Error("模型已改变，请重新选择 Effort");
      const key = fields[task].efforts;
      return {
        ...latest,
        [key]: {
          ...latest[key],
          [provider]: { ...latest[key]?.[provider], [model]: value },
        },
      };
    });

  return (
    <div className="flex flex-col gap-2">
      {tasks.map(([task, label]) => {
        const { model, effort } = taskChoice(config, task);
        const recommended = selectedAgentModel(models, "", task);
        const current = model ? selectedAgentModel(models, model, task) : null;
        const autoLabel = recommended ? `自动 · ${recommended.name}` : "自动";
        const options =
          current && !models.some((m) => m.id === current.id)
            ? [current, ...models]
            : models;
        return (
          <div key={task} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-sm" id={`${task}-model-label`}>
              {label}
            </span>
            <Select
              value={current?.id ?? AUTO}
              disabled={disabled || saving}
              onValueChange={(value) => value && void chooseModel(task, value)}
            >
              <SelectTrigger
                className="min-w-0 flex-1"
                aria-label={`${label}模型`}
                aria-busy={loading || saving}
              >
                <SelectValue>
                  {current?.name ?? (loading ? "加载模型…" : autoLabel)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO} label={autoLabel}>
                  {autoLabel}
                </SelectItem>
                {options.map((m) => (
                  <SelectItem key={m.id} value={m.id} label={m.name}>
                    {m.name}
                  </SelectItem>
                ))}
                {!loading && error && (
                  <div
                    className="px-2 py-1.5 text-xs text-muted-foreground"
                    role="alert"
                  >
                    {error}
                  </div>
                )}
              </SelectContent>
            </Select>
            <Select
              value={effort}
              disabled={disabled || saving}
              onValueChange={(value) =>
                value && void chooseEffort(task, model, value)
              }
            >
              <SelectTrigger className="w-28" aria-label={`${label} Effort`}>
                <SelectValue>{effortLabel(effort)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {efforts.map((value) => (
                  <SelectItem key={value} value={value}>
                    {effortLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
