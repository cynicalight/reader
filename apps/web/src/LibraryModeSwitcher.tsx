import { Check, ChevronDown } from "lucide-react";
import type { LibraryMode } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@reader/ui/components/dropdown-menu";

export const libraryModes: Record<
  LibraryMode,
  { label: string; description: string }
> = {
  books: { label: "图书库", description: "EPUB 与 PDF 书籍、文章" },
  papers: { label: "文献库", description: "论文、文献信息与引用" },
};

export function LibraryModeSwitcher({
  mode,
  onChange,
}: {
  mode: LibraryMode;
  onChange: (mode: LibraryMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="library-mode-trigger"
            aria-label={`切换书库，当前为${libraryModes[mode].label}`}
          />
        }
      >
        {libraryModes[mode].label}
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {(Object.keys(libraryModes) as LibraryMode[]).map((key) => (
          <DropdownMenuItem
            key={key}
            className="library-mode-item"
            onClick={() => onChange(key)}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{libraryModes[key].label}</span>
              <span className="block text-xs text-muted-foreground">
                {libraryModes[key].description}
              </span>
            </span>
            {key === mode && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
