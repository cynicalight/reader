import { expect, it } from "vitest";
import { processingStages } from "./ProcessingStatus";
import type { Processing } from "@reader/core";
const job: Processing = {
  documentId: "test",
  phase: "learning",
  status: "running",
  pagesDone: 3,
  pagesTotal: 13,
  assetsDone: 0,
  assetsTotal: 0,
  translationsDone: 0,
  translationsTotal: 0,
  detail: "",
  updatedAt: "",
};
it("shows measured progress and keeps settling at zero during learning", () => {
  const stages = processingStages(job);
  expect(stages[0].value).toBeCloseTo((3 / 13) * 100);
  expect(stages[1].value).toBe(0);
  expect(stages[1].active).toBe(false);
});
it("measures translation independently after attachments finish", () => {
  for (const status of ["running", "waiting", "failed"] as const) {
    const stages = processingStages({
      ...job,
      phase: "translating",
      status,
      assetsDone: 17,
      assetsTotal: 17,
      translationsDone: 92,
      translationsTotal: 183,
    });
    expect(stages[1].done).toBe(true);
    expect(stages[1].value).toBe(100);
    expect(stages[2].label).toBe("翻译中");
    expect(stages[2].value).toBeCloseTo((92 / 183) * 100);
    expect(stages[2].count).toBe("92 / 183 段");
    expect(stages[2].active).toBe(status === "running");
  }
});
it("stops the glow for failures and waiting connections without pretending to finish", () => {
  for (const status of ["waiting", "failed"] as const) {
    const stages = processingStages({
      ...job,
      phase: "settling",
      status,
      assetsDone: 2,
      assetsTotal: 17,
    });
    expect(stages[0].value).toBe(100);
    expect(stages[1].value).toBeCloseTo((2 / 17) * 100);
    expect(stages[1].active).toBe(false);
  }
});
