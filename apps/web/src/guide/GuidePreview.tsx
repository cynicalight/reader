import { useEffect, useState } from "react";
import { Button } from "@reader/ui/components/button";
import { TooltipProvider } from "@reader/ui/components/tooltip";
import {
  GuideDialog,
  OnboardingDialog,
  ReleaseNotesDialog,
} from "./GuideDialog";
import { releaseNotes } from "./releases";
import { guideTopics } from "./topics";

const themes = ["light", "sepia", "dark"] as const;

/** Development preview of the onboarding, guide and release notes. */
export default function GuidePreview() {
  const [theme, setTheme] = useState<(typeof themes)[number]>("light");
  const [view, setView] = useState<"onboarding" | "guide" | "release" | null>(
    "onboarding",
  );
  const [topic, setTopic] = useState(guideTopics[0].id);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "dark" ? "dark" : "light";
  }, [theme]);
  const [version, items] = Object.entries(releaseNotes).at(-1) ?? ["", []];
  return (
    <TooltipProvider>
      <div className="app flex-col gap-4 p-6">
        <div className="flex flex-wrap gap-2">
          {themes.map((value) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              onClick={() => setTheme(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRun((n) => n + 1);
              setView("onboarding");
            }}
          >
            新手引导
          </Button>
          <Button variant="outline" onClick={() => setView("guide")}>
            指南
          </Button>
          <Button variant="outline" onClick={() => setView("release")}>
            更新内容
          </Button>
        </div>
      </div>
      <OnboardingDialog
        key={run}
        open={view === "onboarding"}
        onFinish={() => setView(null)}
      />
      <GuideDialog
        open={view === "guide"}
        onOpenChange={(open) => setView(open ? "guide" : null)}
        topic={topic}
        onTopicChange={setTopic}
        onAction={() => setView(null)}
      />
      <ReleaseNotesDialog
        open={view === "release"}
        version={version}
        items={items}
        onClose={() => setView(null)}
        onShowTopic={(id) => {
          setTopic(id);
          setView("guide");
        }}
      />
    </TooltipProvider>
  );
}
