import {
  ArrowRightLeft,
  BookOpen,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Pin,
  Star,
  Trash2,
} from "lucide-react";
import type { Document, ReadingStatus } from "@reader/core";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@reader/ui/components/context-menu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@reader/ui/components/dropdown-menu";
import { useReaderStore } from "../store";
import {
  addToCategory,
  removeFromCategory,
  revealFile,
  openLink,
  savePaperPreferences,
  setReadingStatus,
  setStarred,
} from "./actions";
import { paperLink } from "./format";
import { CitationMenuItems } from "./CitationMenu";
import { paperCategories, statusLabels, togglePinned } from "./model";

const kits = {
  context: {
    Item: ContextMenuItem,
    Checkbox: ContextMenuCheckboxItem,
    RadioGroup: ContextMenuRadioGroup,
    Radio: ContextMenuRadioItem,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
  },
  dropdown: {
    Item: DropdownMenuItem,
    Checkbox: DropdownMenuCheckboxItem,
    RadioGroup: DropdownMenuRadioGroup,
    Radio: DropdownMenuRadioItem,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
  },
};

export interface PaperMenuActions {
  open: (doc: Document) => void;
  move: (doc: Document) => void;
  trash: (docs: Document[]) => void;
  newCategory: (docs: Document[]) => void;
}

/** Menu items for one paper, or for every picked paper when it is picked. */
export function PaperMenuItems({
  kind,
  docs,
  actions,
  extra,
}: {
  kind: keyof typeof kits;
  docs: Document[];
  actions: PaperMenuActions;
  extra?: React.ReactNode;
}) {
  const K = kits[kind];
  const all = useReaderStore((s) => s.documents);
  const prefs = useReaderStore((s) => s.libraryPreferences.papers) || {};
  const categories = paperCategories(
    prefs,
    all.filter((d) => d.library === "papers"),
  );
  const one = docs.length === 1 ? docs[0] : undefined;
  const starred = docs.every((d) => d.favorite);
  const status = docs.every((d) => d.readingStatus === docs[0].readingStatus)
    ? docs[0].readingStatus
    : "";
  const pinKey = one ? `doc:${one.id}` : "";
  const link = one ? paperLink(one.metadata) : "";
  return (
    <>
      {one && (
        <K.Item onClick={() => actions.open(one)}>
          <BookOpen />
          打开阅读
        </K.Item>
      )}
      <K.Item onClick={() => void setStarred(docs, !starred)}>
        <Star />
        {starred ? "取消星标" : "加星标"}
      </K.Item>
      {one && (
        <K.Item
          onClick={() =>
            void savePaperPreferences((p) => togglePinned(p, pinKey))
          }
        >
          <Pin />
          {prefs.pinned?.includes(pinKey) ? "取消置顶" : "置顶到侧栏"}
        </K.Item>
      )}
      <K.Separator />
      <K.Sub>
        <K.SubTrigger>分类</K.SubTrigger>
        <K.SubContent className="max-h-80 min-w-44">
          {categories.map((name) => {
            const inside = docs.every((d) =>
              d.tags.some((t) => t.toLowerCase() === name.toLowerCase()),
            );
            return (
              <K.Checkbox
                key={name}
                checked={inside}
                onCheckedChange={() =>
                  void (inside
                    ? removeFromCategory(docs, name)
                    : addToCategory(docs, name))
                }
              >
                <span className="truncate">{name}</span>
              </K.Checkbox>
            );
          })}
          {categories.length > 0 && <K.Separator />}
          <K.Item onClick={() => actions.newCategory(docs)}>
            <FolderPlus />
            新建分类并放入…
          </K.Item>
        </K.SubContent>
      </K.Sub>
      <K.Sub>
        <K.SubTrigger>阅读状态</K.SubTrigger>
        <K.SubContent>
          <K.RadioGroup
            value={status}
            onValueChange={(value: string) =>
              void setReadingStatus(docs, value as ReadingStatus)
            }
          >
            {(Object.keys(statusLabels) as ReadingStatus[]).map((key) => (
              <K.Radio key={key} value={key}>
                {statusLabels[key]}
              </K.Radio>
            ))}
          </K.RadioGroup>
        </K.SubContent>
      </K.Sub>
      <CitationMenuItems kind={kind} docs={docs} nested />
      {extra}
      {one && (
        <>
          <K.Separator />
          {link && (
            <K.Item onClick={() => openLink(link)}>
              <ExternalLink />
              打开论文主页
            </K.Item>
          )}
          {window.readerDesktop?.showDocumentFile && (
            <K.Item onClick={() => revealFile(one)}>
              <FolderOpen />
              {window.readerDesktop.platform === "darwin"
                ? "在访达中显示"
                : "在文件夹中显示"}
            </K.Item>
          )}
          <K.Item onClick={() => actions.move(one)}>
            <ArrowRightLeft />
            移到图书库
          </K.Item>
        </>
      )}
      <K.Separator />
      <K.Item variant="destructive" onClick={() => actions.trash(docs)}>
        <Trash2 />
        {docs.length > 1 ? `将 ${docs.length} 篇移到回收站` : "移到回收站"}
      </K.Item>
    </>
  );
}
