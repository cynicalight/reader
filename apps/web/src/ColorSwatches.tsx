import { Check } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import { highlightPalette } from "./annotations";
import { useReaderStore } from "./store";

/** One button per highlight color; `current` is marked as pressed. */
export function ColorSwatches({
  action,
  current,
  disabled,
  onPick,
}: {
  action: string;
  current?: string;
  disabled?: boolean;
  onPick: (color: string) => void;
}) {
  const palette = highlightPalette(useReaderStore((s) => s.theme));
  return (
    <span className="color-swatches" role="group" aria-label={action}>
      {palette.map((color) => {
        const on = current?.toLowerCase() === color.value;
        return (
          <Button
            key={color.value}
            size="icon-xs"
            variant="ghost"
            aria-label={`${color.label}${action}`}
            title={`${color.label}${action}`}
            aria-pressed={current ? on : undefined}
            disabled={disabled}
            onClick={() => onPick(color.value)}
          >
            <span className="color-swatch" style={{ background: color.value }}>
              {on && <Check />}
            </span>
          </Button>
        );
      })}
    </span>
  );
}
