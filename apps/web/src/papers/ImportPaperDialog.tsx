import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";
import { toast } from "sonner";
import { libraryModes } from "../LibraryModeSwitcher";
import { importReference } from "./actions";

export function ImportPaperDialog({
  open,
  onOpenChange,
  onChooseFiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseFiles: () => void;
}) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!ref.trim() || busy) return;
    setBusy(true);
    try {
      const doc = await importReference(ref);
      if (doc.library === "papers") toast.success(`已导入《${doc.title}》`);
      else
        toast.info(
          `这篇论文已在${libraryModes[doc.library].label}中，可在那里移动`,
        );
      setRef("");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入论文</DialogTitle>
          <DialogDescription>
            arXiv 编号、DOI、论文页面或 PDF 链接、完整标题
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            aria-label="论文标识或链接"
            placeholder="例如 2401.01234 或 10.1145/…"
            value={ref}
            disabled={busy}
            onChange={(e) => setRef(e.target.value)}
          />
          <Button type="submit" disabled={!ref.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? "下载中" : "导入"}
          </Button>
        </form>
        <div className="paper-import-divider">或</div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            onOpenChange(false);
            onChooseFiles();
          }}
        >
          <FileUp />
          选择 PDF 文件
        </Button>
      </DialogContent>
    </Dialog>
  );
}
