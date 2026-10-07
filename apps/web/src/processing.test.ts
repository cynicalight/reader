import { expect, it } from "vitest";
import { processingStages } from "./ProcessingStatus";
import type { Processing } from "@reader/core";
const job: Processing = {
  documentId: "test",
  phase: "learning",
  status: "running",
  pagesDone: 3,
  pagesTotal: 13,
  translationsDone: 0,
  translationsTotal: 0,
  detail: "",
  updatedAt: "",
};
it("shows measured learning progress without a consolidation stage", () => {
  const stages = processingStages(job);
  expect(stages.map((stage) => stage.key)).toEqual(["learning", "translating"]);
  expect(stages[0].value).toBeCloseTo((3 / 13) * 100);
  expect(stages[1].value).toBe(0);
  expect(stages[1].active).toBe(false);
});
it("measures translation after learning", () => {
  for (const status of ["running", "waiting", "failed"] as const) {
    const stages = processingStages({
      ...job,
      phase: "translating",
      status,
      translationsDone: 92,
      translationsTotal: 183,
    });
    expect(stages[0].value).toBe(100);
    expect(stages[1].label).toBe("翻译中");
    expect(stages[1].value).toBeCloseTo((92 / 183) * 100);
    expect(stages[1].count).toBe("92 / 183 段");
    expect(stages[1].active).toBe(status === "running");
  }
});
