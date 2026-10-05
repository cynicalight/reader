import { useEffect, useRef, useState } from "react";
import { api } from "@reader/api";
import { toast } from "sonner";

export function useAnnotationDeletion(
  documentId: string,
  onDeleted: (id: string) => void,
) {
  const pending = useRef(new Set<string>());
  const generation = useRef(0);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    pending.current = new Set();
    setDeleting(new Set());
    return () => {
      generation.current++;
    };
  }, [documentId]);
  const remove = async (id: string) => {
    if (pending.current.has(id)) return;
    const current = generation.current;
    pending.current.add(id);
    setDeleting(new Set(pending.current));
    try {
      await api.removeAnnotation(documentId, id);
      if (generation.current === current) onDeleted(id);
    } catch (error) {
      if (generation.current === current) toast.error((error as Error).message);
    } finally {
      if (generation.current === current) {
        pending.current.delete(id);
        setDeleting(new Set(pending.current));
      }
    }
  };
  return { deleting, remove };
}
