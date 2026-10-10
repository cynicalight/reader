import type { GuidePreferences } from "@reader/core";

export interface ReleaseItem {
  title: string;
  body?: string;
  /** A guide topic that demonstrates this change. */
  topic?: string;
}

/**
 * Notes for important releases, keyed by the desktop package version. A
 * version without an entry updates silently.
 */
export const releaseNotes: Record<string, ReleaseItem[]> = {
  "0.4.0": [
    {
      title: "新增指南",
      body: "侧栏「关于」上方的「指南」演示了设置 Agent、选择模型、导入论文和阅读界面。",
      topic: "agent",
    },
    {
      title: "从 Zotero 导入",
      body: "在「导入论文」中预览并迁移本机 Zotero 的 PDF、论文信息、分类、标签、笔记和可转换的批注。",
    },
    {
      title: "从浏览器收录论文",
      body: "安装 Reader Connector 后，可从论文页面收录 PDF，并选择 Reader 论文库中已有的分类和标签。",
    },
  ],
};

export type GuideLaunch =
  | { kind: "onboarding" }
  | { kind: "release"; items: ReleaseItem[] }
  | { kind: "none"; save?: GuidePreferences };

/**
 * Decides what to show at startup. Libraries created before the guide existed
 * count as onboarded, so existing users see release notes instead.
 */
export function guideLaunch(
  preferences: GuidePreferences,
  version: string,
  hasDocuments: boolean,
): GuideLaunch {
  if (!preferences.onboarded && !hasDocuments) return { kind: "onboarding" };
  if (preferences.seenVersion === version)
    return preferences.onboarded
      ? { kind: "none" }
      : { kind: "none", save: { ...preferences, onboarded: true } };
  const items = releaseNotes[version];
  if (items?.length) return { kind: "release", items };
  return {
    kind: "none",
    save: { ...preferences, onboarded: true, seenVersion: version },
  };
}
