import { useEffect, useRef, useState } from "react";
import { api } from "@reader/api";
import type { GuidePreferences } from "@reader/core";
import { toast } from "sonner";
import {
  GuideDialog,
  OnboardingDialog,
  ReleaseNotesDialog,
} from "./GuideDialog";
import { guideLaunch, type ReleaseItem } from "./releases";
import { guideTopics, type GuideAction } from "./topics";

/**
 * Shows the onboarding on first launch, release notes after an important
 * update, and the guide whenever it is opened.
 */
export function GuideHost({
  ready,
  version,
  hasDocuments,
  open,
  onOpenChange,
  onAction,
}: {
  /** The library has loaded. */
  ready: boolean;
  version: string;
  hasDocuments: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: GuideAction) => void;
}) {
  const [onboarding, setOnboarding] = useState(false);
  const [release, setRelease] = useState<ReleaseItem[] | null>(null);
  const [topic, setTopic] = useState(guideTopics[0].id);
  const preferences = useRef<GuidePreferences>({});
  const launched = useRef(false);
  const save = (patch: GuidePreferences) => {
    preferences.current = { ...preferences.current, ...patch };
    void api
      .saveGuidePreferences(preferences.current)
      .catch((e) => toast.error((e as Error).message));
  };
  useEffect(() => {
    if (!ready || launched.current) return;
    launched.current = true;
    void api
      .guidePreferences()
      .then((saved) => {
        preferences.current = saved;
        const launch = guideLaunch(saved, version, hasDocuments);
        if (launch.kind === "onboarding") setOnboarding(true);
        else if (launch.kind === "release") setRelease(launch.items);
        else if (launch.save) save(launch.save);
      })
      // Without saved state, showing nothing is safer than repeating the guide.
      .catch(() => {});
  }, [ready]);
  const finishOnboarding = () => {
    setOnboarding(false);
    save({ onboarded: true, seenVersion: version });
  };
  const closeRelease = () => {
    setRelease(null);
    save({ onboarded: true, seenVersion: version });
  };
  return (
    <>
      <OnboardingDialog open={onboarding} onFinish={finishOnboarding} />
      <ReleaseNotesDialog
        open={!!release}
        version={version}
        items={release ?? []}
        onClose={closeRelease}
        onShowTopic={(id) => {
          closeRelease();
          setTopic(id);
          onOpenChange(true);
        }}
      />
      <GuideDialog
        open={open}
        onOpenChange={onOpenChange}
        topic={topic}
        onTopicChange={setTopic}
        onAction={(action) => {
          onOpenChange(false);
          onAction(action);
        }}
      />
    </>
  );
}
