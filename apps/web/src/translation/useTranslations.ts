import { useEffect, useState } from "react";
import type { TranslationBlock } from "@reader/core";
import { api } from "@reader/api";
export function useTranslations(documentId: string) {
  const [translations, setTranslations] = useState<TranslationBlock[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setTranslations([]);
    setError("");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 500;
    const subscribe = async () => {
      try {
        await api.translationStream(documentId, controller.signal, (event) => {
          if (controller.signal.aborted) return;
          retryDelay = 500;
          setError("");
          if (event.event === "snapshot") setTranslations(event.data);
          else
            setTranslations((current) => {
              const index = current.findIndex(
                (b) => b.blockId === event.data.blockId,
              );
              if (index < 0) return [...current, event.data];
              return current.map((b, i) => (i === index ? event.data : b));
            });
        });
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(() => void subscribe(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 5000);
        }
      }
    };
    void subscribe();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [documentId]);
  return { translations, error };
}
