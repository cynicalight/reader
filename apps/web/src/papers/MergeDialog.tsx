import { useState } from "react";
import type { Document } from "@reader/core";
import { api } from "@reader/api";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";
import { RadioGroup, RadioGroupItem } from "@reader/ui/components/radio-group";
import { toast } from "sonner";
import { refreshLibrary, refreshTrash } from "../store";
import { paperByline } from "./format";
import { usePaperUI } from "./state";

const filled = (doc: Document) =>
  Object.entries(doc.metadata).filter(
    ([key, value]) =>
      !["sources", "lookup", "lookedUpAt"].includes(key) &&
      (Array.isArray(value) ? value.length : value),
  ).length;

/** The version with the most reading work, then the fullest metadata. */
export function preferredVersion(group: Document[]) {
  const work = (d: Document) => d.noteCount + d.highlightCount;
  return [...group].sort(
    (a, b) =>
      work(b) - work(a) ||
      filled(b) - filled(a) ||
      a.createdAt.localeCompare(b.createdAt),
  )[0];
}

const sizeLabel = (bytes: number) =>
  bytes >= 1 << 20
    ? `${(bytes / (1 << 20)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Pick the version to keep; the others are folded into it and trashed. */
export function MergeDialog({
  group,
  onClose,
}: {
  group: Document[];
  onClose: () => void;
}) {
  const [master, setMaster] = useState(() => preferredVersion(group).id);
  const [saving, setSaving] = useState(false);
  const merge = async () => {
    setSaving(true);
    try {
      const others = group.filter((d) => d.id !== master).map((d) => d.id);
      await api.mergeDocuments(master, others);
      toast.success(`已合并 ${group.length} 个版本`);
      usePaperUI.getState().select(master);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
      await Promise.all([refreshLibrary(), refreshTrash()]).catch(() => {});
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>合并 {group.length} 个版本</DialogTitle>
          <DialogDescription>
            保留所选版本的文件和标题。其余版本的分类和星标并入，缺少的文献信息和论文笔记一并补上；之后它们移到回收站，批注和对话仍在原文件上，可随时恢复。
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={master}
          onValueChange={(value) => setMaster(value as string)}
          aria-label="保留的版本"
          className="gap-1"
        >
          {group.map((doc) => (
            <label key={doc.id} className="paper-merge-option">
              <RadioGroupItem value={doc.id} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {doc.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {paperByline(doc) || "无文献信息"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {[
                    sizeLabel(doc.size),
                    `添加于 ${new Date(doc.createdAt).toLocaleDateString("zh-CN")}`,
                    doc.noteCount && `${doc.noteCount} 条批注`,
                    doc.highlightCount && `${doc.highlightCount} 处划线`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void merge()}>
            合并
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
