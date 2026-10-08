import { useState } from "react";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";

/** Names a new category; `count` papers are placed in it on save. */
export function CategoryDialog({
  count,
  parent,
  onSave,
  onClose,
}: {
  count: number;
  parent?: string;
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (await onSave(name)) onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{parent ? "新建子分类" : "新建分类"}</DialogTitle>
          <DialogDescription className={count || parent ? "" : "sr-only"}>
            {[
              parent && `位于“${parent.replaceAll("/", " / ")}”`,
              count && `放入所选的 ${count} 篇论文`,
            ]
              .filter(Boolean)
              .join("，") || "输入分类名"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            maxLength={40}
            aria-label="分类名"
            placeholder="分类名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || saving}>
            创建
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
