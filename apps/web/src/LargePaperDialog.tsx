import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@reader/ui/components/alert-dialog";

export interface LargePaper {
  name: string;
  pages: number;
  /** Browser uploads keep the file; desktop imports keep a one-time ID. */
  file?: File;
  id?: string;
}

export function LargePaperDialog({
  papers,
  busy,
  onChoose,
  onCancel,
}: {
  papers: LargePaper[];
  busy: boolean;
  onChoose: (library: "papers" | "books") => void;
  onCancel: () => void;
}) {
  const [first] = papers;
  return (
    <AlertDialog
      open={papers.length > 0}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>检测到 PDF 过大</AlertDialogTitle>
          <AlertDialogDescription>
            {papers.length === 1
              ? `“${first?.name}”有 ${first?.pages} 页。`
              : `${papers.length} 份 PDF 超过 50 页。`}
            作为论文导入会一次翻译全文，耗时较长；导入为图书后按章节翻译。是否导入为图书？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            variant="outline"
            disabled={busy}
            onClick={() => onChoose("papers")}
          >
            仍然导入为论文
          </AlertDialogAction>
          <AlertDialogAction disabled={busy} onClick={() => onChoose("books")}>
            导入到图书库
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
