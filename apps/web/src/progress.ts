import type { DocumentLocation } from "@reader/core";
import { api } from "@reader/api";
type Progress = { progress: DocumentLocation; percentage: number };
let latest: { id: string; patch: Progress; version: number } | undefined;
const versions = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<unknown> = Promise.resolve();
let lastError: unknown;
export function scheduleProgress(
  id: string,
  patch: Progress,
  onError: (error: Error) => void,
) {
  const version = (versions.get(id) || 0) + 1;
  versions.set(id, version);
  latest = { id, patch, version };
  clearTimeout(timer);
  timer = setTimeout(() => {
    void flushProgress().catch(onError);
  }, 350);
}
export async function flushProgress() {
  clearTimeout(timer);
  const update = latest;
  latest = undefined;
  if (update) {
    saving = saving
      .catch(() => {})
      .then(async () => {
        try {
          await api.update(update.id, update.patch);
          lastError = undefined;
        } catch (error) {
          lastError = error;
          if (!latest && versions.get(update.id) === update.version)
            latest = update;
          throw error;
        }
      });
  }
  await saving;
  if (lastError) throw lastError;
  if (latest) await flushProgress();
}
