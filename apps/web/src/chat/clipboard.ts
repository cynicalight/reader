import { toast } from "sonner";
export async function copyText(text: string, successMessage?: string) {
  try {
    if (window.readerDesktop?.writeClipboardText)
      await window.readerDesktop.writeClipboardText(text);
    else await navigator.clipboard.writeText(text);
    if (successMessage)
      toast.success(successMessage, { id: "reader-clipboard" });
    return true;
  } catch {
    toast.error("复制失败，请选择文字后复制。", { id: "reader-clipboard" });
    return false;
  }
}
