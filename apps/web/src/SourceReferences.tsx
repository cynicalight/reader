import { useRef, useState } from "react";
import { ArrowUpRight, Loader2, Quote } from "lucide-react";
import type {
  DocumentLocation,
  Message,
  ReaderAdapter,
  TOCItem,
} from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@reader/ui/components/popover";
import {
  referenceCards,
  referenceLabel,
  type ReferenceCard,
} from "./references";

export function SourceReferences({
  message,
  toc,
  adapter,
  onNavigate,
}: {
  message: Message;
  toc: TOCItem[];
  adapter?: ReaderAdapter;
  onNavigate: (location: DocumentLocation) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<ReferenceCard[]>();
  const request = useRef(0);
  const cards = referenceCards(message, toc);
  if (!cards.length) return null;
  const choose = async (card: ReferenceCard) => {
    if (!adapter || pending) return;
    const serial = ++request.current;
    setPending(card.id);
    setError("");
    try {
      let target = card.location;
      if (!target) {
        // Search the original excerpt, not a model-generated paraphrase.
        const text = card.text.replace(/\s+/g, " ").trim();
        let matches = await adapter.search(text.slice(0, 80));
        if (!matches.length) matches = await adapter.search(text.slice(0, 40));
        if (serial !== request.current) return;
        if (!matches.length)
          throw new Error("未找到对应原文，可在书内搜索中查找。");
        if (matches.length > 1) {
          setCandidates(
            matches.map((match, i) => ({
              ...card,
              id: `match-${i}`,
              label: referenceLabel(match.location, toc),
              location: match.location,
            })),
          );
          return;
        }
        target = matches[0].location;
      }
      await onNavigate(target);
      if (serial === request.current) setOpen(false);
    } catch (e) {
      if (serial === request.current) setError((e as Error).message);
    } finally {
      if (serial === request.current) setPending(undefined);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        request.current++;
        setPending(undefined);
        setError("");
        setCandidates(undefined);
      }}
    >
      <PopoverTrigger
        render={
          <Button size="sm" variant="ghost" className="mt-2 h-6 text-xs" />
        }
      >
        <Quote className="size-3" />
        引用原文
      </PopoverTrigger>
      <PopoverContent align="end" className="reference-popover">
        <PopoverTitle className="px-1 py-1 text-xs text-muted-foreground">
          {candidates ? "选择原文位置" : `引用原文 · ${cards.length}`}
        </PopoverTitle>
        <div className="reference-list" role="list" aria-label="原文引用列表">
          {(candidates || cards).map((card) => (
            <div role="listitem" key={card.id}>
              <Button
                variant="ghost"
                className="reference-card"
                disabled={!adapter || !!pending}
                onClick={() => void choose(card)}
              >
                <span className="reference-card-heading">
                  <span>{card.label}</span>
                  {pending === card.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ArrowUpRight className="size-3" />
                  )}
                </span>
                <span className="reference-card-excerpt">{card.preview}</span>
              </Button>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {error}
          </p>
        )}
        {candidates && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCandidates(undefined);
              setError("");
            }}
          >
            返回引用列表
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
