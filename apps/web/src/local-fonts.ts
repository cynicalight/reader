/** Font families installed on this computer, via the Local Font Access API. */
type FontData = { family: string };
type FontQuery = () => Promise<FontData[]>;

export const canQueryLocalFonts = () =>
  typeof (window as { queryLocalFonts?: FontQuery }).queryLocalFonts ===
  "function";

let cached: Promise<string[]> | undefined;

/**
 * Unique family names, A–Z. Needs a user gesture the first time; a refusal
 * rejects and the next call asks again.
 */
export function localFontFamilies(): Promise<string[]> {
  const query = (window as { queryLocalFonts?: FontQuery }).queryLocalFonts;
  if (!query) return Promise.reject(new Error("当前环境无法读取本机字体"));
  cached ??= query
    .call(window)
    .then((fonts) =>
      [...new Set(fonts.map((font) => font.family).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "zh"),
      ),
    )
    .catch((error: unknown) => {
      cached = undefined;
      throw error instanceof Error && error.name === "SecurityError"
        ? new Error("没有读取本机字体的权限")
        : error;
    });
  return cached;
}
