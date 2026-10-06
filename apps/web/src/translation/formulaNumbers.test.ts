import { expect, it } from "vitest";
import type { PDFBlock } from "@reader/core";
import { formulaNumbers } from "./formulaNumbers";
function block(
  id: string,
  label: string,
  x: number,
  y: number,
  width = 0.12,
  height = 0.03,
  page = 1,
): PDFBlock {
  return {
    id,
    label,
    page,
    text: label === "formula_number" ? "(9)" : "x",
    bounds: { x, y, width, height },
  };
}
it("pairs numbers with the adjacent formula in the same column", () => {
  const result = formulaNumbers([
    block("left", "display_formula", 0.2, 0.72),
    block("right", "display_formula", 0.63, 0.73),
    block("ln", "formula_number", 0.45, 0.73, 0.02, 0.01),
    block("rn", "formula_number", 0.87, 0.74, 0.02, 0.01),
  ]);
  expect([...result.byFormula.keys()]).toEqual(["left", "right"]);
  expect([...result.pairedIds]).toEqual(["ln", "rn"]);
});
it("keeps unrelated, different-page, and ambiguous numbers separate", () => {
  const result = formulaNumbers([
    block("f", "display_formula", 0.2, 0.2),
    block("f2", "display_formula", 0.2, 0.2),
    block("ambiguous", "formula_number", 0.45, 0.2),
    block("other-page", "formula_number", 0.45, 0.2, 0.02, 0.01, 2),
    block("below", "formula_number", 0.45, 0.4),
  ]);
  expect(result.pairedIds.size).toBe(0);
});
it("associates a formula only once", () => {
  const result = formulaNumbers([
    block("f", "display_formula", 0.2, 0.2),
    block("n", "formula_number", 0.45, 0.2),
    block("n2", "formula_number", 0.45, 0.2),
  ]);
  expect([...result.pairedIds]).toEqual(["n"]);
});

it("pairs all six equations from the processed Focal Loss page", () => {
  const blocks: PDFBlock[] = [
    {
      id: "p1-b6",
      page: 1,
      label: "display_formula",
      text: "x = yx, t",
      bounds: {
        x: 0.24150389627693525,
        y: 0.5819099118011166,
        width: 0.06426321291456039,
        height: 0.013263817989464965,
      },
    },
    {
      id: "p1-b7",
      page: 1,
      label: "formula_number",
      text: "(6)",
      bounds: {
        x: 0.4481746698516646,
        y: 0.5809871403857915,
        width: 0.020205080119612973,
        height: 0.013105642915976157,
      },
    },
    {
      id: "p1-b10",
      page: 1,
      label: "display_formula",
      text: "p ∗ = σ ( γx + β ) , t t",
      bounds: {
        x: 0.21089082605698528,
        y: 0.7068886805062342,
        width: 0.12521387237349368,
        height: 0.015258866127091264,
      },
    },
    {
      id: "p1-b11",
      page: 1,
      label: "formula_number",
      text: "(7)",
      bounds: {
        x: 0.44819042729396447,
        y: 0.7074620410649464,
        width: 0.02039382036994486,
        height: 0.012916642005997403,
      },
    },
    {
      id: "p1-b12",
      page: 1,
      label: "display_formula",
      text: "FL ∗ = − log( p ∗ ) /γ. t",
      bounds: {
        x: 0.20296545589671416,
        y: 0.7251158434935291,
        width: 0.14112195781632964,
        height: 0.015995988942155925,
      },
    },
    {
      id: "p1-b13",
      page: 1,
      label: "formula_number",
      text: "(8)",
      bounds: {
        x: 0.44821057288475286,
        y: 0.726842321530737,
        width: 0.019297531227660314,
        height: 0.012061995689315097,
      },
    },
    {
      id: "p1-b22",
      page: 1,
      label: "display_formula",
      text: "d CE = y ( p − 1) t dx",
      bounds: {
        x: 0.6370073704937704,
        y: 0.7386077726730192,
        width: 0.12004707685483051,
        height: 0.03072380297111743,
      },
    },
    {
      id: "p1-b23",
      page: 1,
      label: "formula_number",
      text: "(9)",
      bounds: {
        x: 0.871080086901297,
        y: 0.7482799953884549,
        width: 0.020110784792432557,
        height: 0.012670035314078287,
      },
    },
    {
      id: "p1-b24",
      page: 1,
      label: "display_formula",
      text: "d FL = y (1 − p ) γ ( γp log( p ) + p − 1) t t t t dx",
      bounds: {
        x: 0.5628499548419629,
        y: 0.7717557194257023,
        width: 0.26919949600119997,
        height: 0.027584114460030063,
      },
    },
    {
      id: "p1-b25",
      page: 1,
      label: "formula_number",
      text: "(10)",
      bounds: {
        x: 0.8628633785871119,
        y: 0.7791924524788905,
        width: 0.028182285283905206,
        height: 0.01315477159288192,
      },
    },
    {
      id: "p1-b26",
      page: 1,
      label: "display_formula",
      text: "d FL ∗ = y ( p ∗ − 1) dx t",
      bounds: {
        x: 0.6319512261284722,
        y: 0.8007790921914457,
        width: 0.12983105229396452,
        height: 0.031537065602312175,
      },
    },
    {
      id: "p1-b27",
      page: 1,
      label: "formula_number",
      text: "(11)",
      bounds: {
        x: 0.8624261594286152,
        y: 0.8103579126223169,
        width: 0.02869330512152779,
        height: 0.013685746626420414,
      },
    },
  ];
  const result = formulaNumbers(blocks);
  expect([...result.byFormula.values()]).toEqual([
    "(6)",
    "(7)",
    "(8)",
    "(9)",
    "(10)",
    "(11)",
  ]);
  expect(result.pairedIds.size).toBe(6);
});
