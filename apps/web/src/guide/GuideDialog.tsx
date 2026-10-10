import { useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@reader/ui/components/tabs";
import { SceneCanvas } from "./SceneCanvas";
import { scenes } from "./scenes";
import {
  guideTopics,
  onboardingPages,
  type GuideAction,
  type GuidePage,
  type GuideTopic,
} from "./topics";
import type { ReleaseItem } from "./releases";
import "./guide.css";

/** One step: the demonstration, then its explanation. */
function GuideStepView({ page }: { page: GuidePage }) {
  const { step, topic } = page;
  return (
    <>
      <div className="guide-stage">
        <SceneCanvas
          key={step.id}
          scene={scenes[step.scene]}
          label={`演示：${step.title}`}
        />
      </div>
      <DialogHeader className="gap-1.5">
        <p className="text-xs text-muted-foreground">
          {topic.title}
          {topic.steps.length > 1 &&
            ` · ${page.index + 1}/${topic.steps.length}`}
        </p>
        <DialogTitle className="text-base">{step.title}</DialogTitle>
        <DialogDescription className="leading-6">{step.body}</DialogDescription>
      </DialogHeader>
    </>
  );
}

function Dots({ count, current }: { count: number; current: number }) {
  if (count < 2) return <span />;
  return (
    <span className="guide-dots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-active={i === current || undefined} />
      ))}
    </span>
  );
}

const arrowKeys =
  (back: () => void, next: () => void) => (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('[role="tablist"]')) return;
    if (event.key === "ArrowLeft") back();
    if (event.key === "ArrowRight") next();
  };

/** The first-run walkthrough of every onboarding topic. */
export function OnboardingDialog({
  open,
  onFinish,
}: {
  open: boolean;
  onFinish: () => void;
}) {
  const pages = onboardingPages();
  const [index, setIndex] = useState(0);
  const page = pages[index];
  const last = index === pages.length - 1;
  const back = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => (last ? onFinish() : setIndex(index + 1));
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onFinish()}>
      <DialogContent
        className="guide-dialog sm:max-w-2xl"
        onKeyDown={arrowKeys(back, () => !last && next())}
      >
        <GuideStepView page={page} />
        <DialogFooter className="guide-footer">
          <Dots count={pages.length} current={index} />
          <span className="sr-only" aria-live="polite">
            第 {index + 1} 步，共 {pages.length} 步
          </span>
          {!last && (
            <Button variant="ghost" onClick={onFinish}>
              跳过
            </Button>
          )}
          {index > 0 && (
            <Button variant="outline" onClick={back}>
              上一步
            </Button>
          )}
          <Button autoFocus onClick={next}>
            {last ? "开始使用" : "下一步"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TopicPanel({
  topic,
  onNextTopic,
  onPreviousTopic,
  onAction,
}: {
  topic: GuideTopic;
  onNextTopic?: () => void;
  onPreviousTopic?: () => void;
  onAction: (action: GuideAction) => void;
}) {
  const [index, setIndex] = useState(0);
  const step = Math.min(index, topic.steps.length - 1);
  const back = () => (step > 0 ? setIndex(step - 1) : onPreviousTopic?.());
  const next = () =>
    step < topic.steps.length - 1 ? setIndex(step + 1) : onNextTopic?.();
  return (
    <div className="guide-panel" onKeyDown={arrowKeys(back, next)}>
      <GuideStepView page={{ topic, step: topic.steps[step], index: step }} />
      <div className="guide-footer">
        <Dots count={topic.steps.length} current={step} />
        {topic.action && (
          <Button variant="ghost" onClick={() => onAction(topic.action!.kind)}>
            {topic.action.label}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label="上一步"
          disabled={step === 0 && !onPreviousTopic}
          onClick={back}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="下一步"
          disabled={step === topic.steps.length - 1 && !onNextTopic}
          onClick={next}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Every guide topic, browsable at any time. */
export function GuideDialog({
  open,
  onOpenChange,
  topic,
  onTopicChange,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: string;
  onTopicChange: (topic: string) => void;
  onAction: (action: GuideAction) => void;
}) {
  const index = Math.max(
    0,
    guideTopics.findIndex((t) => t.id === topic),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="guide-dialog guide-browser sm:max-w-4xl">
        <DialogTitle className="sr-only">指南</DialogTitle>
        <Tabs
          orientation="vertical"
          value={guideTopics[index].id}
          onValueChange={(value) => onTopicChange(String(value))}
          className="guide-layout"
        >
          <div className="guide-nav">
            <h2 className="mb-3 px-2 text-sm font-medium">指南</h2>
            <TabsList variant="line" aria-label="指南主题" className="w-full">
              {guideTopics.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="h-9 px-2">
                  <t.icon />
                  {t.title}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {guideTopics.map((t, i) => (
            <TabsContent key={t.id} value={t.id} className="min-w-0">
              <TopicPanel
                topic={t}
                onAction={onAction}
                onPreviousTopic={
                  i > 0 ? () => onTopicChange(guideTopics[i - 1].id) : undefined
                }
                onNextTopic={
                  i < guideTopics.length - 1
                    ? () => onTopicChange(guideTopics[i + 1].id)
                    : undefined
                }
              />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** What changed in this version; topics link to their demonstration. */
export function ReleaseNotesDialog({
  open,
  version,
  items,
  onClose,
  onShowTopic,
}: {
  open: boolean;
  version: string;
  items: ReleaseItem[];
  onClose: () => void;
  onShowTopic: (topic: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="guide-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reader {version} 更新内容</DialogTitle>
          <DialogDescription className="sr-only">
            本次更新的主要变化
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.title} className="space-y-1">
              <p className="font-medium">{item.title}</p>
              {item.body && (
                <p className="leading-6 text-muted-foreground">{item.body}</p>
              )}
              {item.topic && guideTopics.some((t) => t.id === item.topic) && (
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => onShowTopic(item.topic!)}
                >
                  查看演示
                </Button>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button autoFocus onClick={onClose}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
