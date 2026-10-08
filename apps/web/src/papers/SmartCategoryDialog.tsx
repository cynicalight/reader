import { useState } from "react";
import type { SmartCategory } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@reader/ui/components/toggle-group";

/** Name a smart category and pick the tags its papers must all carry. */
export function SmartCategoryDialog({
  smart,
  tags,
  isNew,
  onSave,
  onClose,
}: {
  smart: SmartCategory;
  /** Tags used in the library, offered as choices. */
  tags: string[];
  isNew: boolean;
  onSave: (smart: SmartCategory) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(smart.name);
  const [chosen, setChosen] = useState<string[]>(smart.tags);
  const [extra, setExtra] = useState("");
  // Chosen tags no paper carries yet stay listed so they can be removed.
  const choices = [
    ...tags,
    ...chosen.filter(
      (tag) => !tags.some((t) => t.toLowerCase() === tag.toLowerCase()),
    ),
  ];
  const addExtra = () => {
    const tag = extra.trim().replace(/^#/, "");
    if (tag && !chosen.some((t) => t.toLowerCase() === tag.toLowerCase()))
      setChosen([...chosen, tag]);
    setExtra("");
  };
  const valid = name.trim() && [...name.trim()].length <= 40 && chosen.length;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "新建智能标签分类" : "编辑智能标签分类"}
          </DialogTitle>
          <DialogDescription>
            自动收录同时带有所选全部标签的论文
          </DialogDescription>
        </DialogHeader>
        <form
          id="smart-category"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSave({ ...smart, name: name.trim(), tags: chosen });
            onClose();
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
          {choices.length > 0 && (
            <ToggleGroup
              multiple
              aria-label="所需标签"
              size="sm"
              variant="outline"
              className="flex-wrap justify-start"
              value={chosen}
              onValueChange={(value: string[]) => setChosen(value)}
            >
              {choices.map((tag) => (
                <ToggleGroupItem key={tag} value={tag} className="px-2 text-xs">
                  #{tag}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <Input
            aria-label="添加标签"
            placeholder="输入其他标签，回车添加"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addExtra();
              }
            }}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="smart-category" disabled={!valid}>
            {isNew ? "创建" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
