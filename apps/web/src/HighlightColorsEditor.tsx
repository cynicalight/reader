import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { HighlightColor } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  MAX_HIGHLIGHT_COLORS,
  highlightColors,
  highlightPalette,
  validHighlightColor,
} from "./annotations";
import { useReaderStore } from "./store";

/** Add, rename, recolor, reorder and remove highlight colors. */
export function HighlightColorsEditor() {
  const theme = useReaderStore((s) => s.theme);
  const setTheme = useReaderStore((s) => s.setTheme);
  const palette = highlightPalette(theme);
  // Hex text being typed, by row, until it is a valid color.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const save = (next: HighlightColor[]) => setTheme({ highlightColors: next });
  const change = (index: number, patch: Partial<HighlightColor>) =>
    save(palette.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...palette];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    save(next);
  };
  const unused = () =>
    [
      "#e6b94c",
      "#6cc58c",
      "#5b9fe8",
      "#e8746b",
      "#a985e0",
      "#4fb3a9",
      "#e58fb5",
      "#9aa0a6",
    ].find((value) => !palette.some((c) => c.value.toLowerCase() === value)) ||
    "#9aa0a6";
  const isDefault = JSON.stringify(palette) === JSON.stringify(highlightColors);
  return (
    <div className="space-y-2">
      {palette.map((color, index) => (
        <div key={index} className="highlight-color-row">
          <Input
            type="color"
            aria-label={`${color.label}的颜色`}
            value={color.value}
            className="highlight-color-picker"
            onChange={(e) => change(index, { value: e.target.value })}
          />
          <Input
            aria-label={`颜色 ${index + 1} 的名称`}
            maxLength={8}
            defaultValue={color.label}
            key={`${index}:${color.label}`}
            className="h-8 w-24"
            onBlur={(e) => {
              const label = e.currentTarget.value.trim();
              if (!label) e.currentTarget.value = color.label;
              else if (label !== color.label) change(index, { label });
            }}
          />
          <Input
            aria-label={`颜色 ${index + 1} 的色值`}
            value={drafts[index] ?? color.value}
            className="h-8 w-24 font-mono text-xs"
            onChange={(e) => {
              const value = e.target.value.trim();
              setDrafts((d) => ({ ...d, [index]: value }));
              if (validHighlightColor(value)) change(index, { value });
            }}
            onBlur={() => setDrafts(({ [index]: _, ...rest }) => rest)}
          />
          <span className="ml-auto flex">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`上移${color.label}`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`下移${color.label}`}
              disabled={index === palette.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`删除${color.label}`}
              disabled={palette.length <= 1}
              onClick={() => save(palette.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </span>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={palette.length >= MAX_HIGHLIGHT_COLORS}
          onClick={() =>
            save([...palette, { value: unused(), label: "新颜色" }])
          }
        >
          <Plus />
          添加颜色
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isDefault}
          onClick={() => save([...highlightColors])}
        >
          <RotateCcw />
          恢复默认
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        最多 {MAX_HIGHLIGHT_COLORS} 种。删除颜色不会改变已有的高亮。
      </p>
    </div>
  );
}
