import { useMemo, useSyncExternalStore } from "react";
import type { ReaderTheme } from "@reader/core";
const query = "(prefers-color-scheme: dark)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
export function resolveTheme(
  theme: ReaderTheme,
  systemDark: boolean,
): ReaderTheme {
  const appearance = theme.appearance ?? "system";
  const mode =
    appearance === "system"
      ? systemDark
        ? "dark"
        : "light"
      : appearance === "dark"
        ? "dark"
        : theme.mode === "sepia"
          ? "sepia"
          : "light";
  return { ...theme, mode };
}
export function useResolvedTheme(theme: ReaderTheme) {
  const dark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  return useMemo(() => resolveTheme(theme, dark), [theme, dark]);
}
