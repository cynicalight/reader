import type { PDFBlock } from "@reader/core";

/** Pair neighboring equation numbers without changing the extracted source blocks. */
export function formulaNumbers(blocks: PDFBlock[]) {
  const byFormula = new Map<string, string>();
  const pairedIds = new Set<string>();
  const formulas = blocks.filter((b) => b.label === "display_formula");
  for (const number of blocks) {
    if (number.label !== "formula_number" || !number.text.trim()) continue;
    const n = number.bounds;
    const candidates = formulas
      .flatMap((formula) => {
        if (formula.page !== number.page || byFormula.has(formula.id))
          return [];
        const f = formula.bounds;
        const overlap =
          Math.min(f.y + f.height, n.y + n.height) - Math.max(f.y, n.y);
        const gap = n.x - (f.x + f.width);
        if (
          Math.min(f.height, n.height) <= 0 ||
          overlap / Math.min(f.height, n.height) < 0.4 ||
          gap < -0.01 ||
          gap > 0.25
        )
          return [];
        return [
          {
            formula,
            distance:
              Math.max(0, gap) +
              Math.abs(f.y + f.height / 2 - n.y - n.height / 2),
          },
        ];
      })
      .sort((a, b) => a.distance - b.distance);
    if (
      !candidates.length ||
      (candidates[1] && candidates[1].distance - candidates[0].distance < 0.01)
    )
      continue;
    byFormula.set(candidates[0].formula.id, number.text.trim());
    pairedIds.add(number.id);
  }
  return { byFormula, pairedIds };
}
