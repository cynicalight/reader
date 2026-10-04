import { toast } from "sonner";
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error("复制失败，请选择文字后复制。");
  }
}
