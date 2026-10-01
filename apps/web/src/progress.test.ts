import { afterEach, expect, it, vi } from "vitest";
const update = vi.hoisted(() => vi.fn());
vi.mock("@reader/api", () => ({ api: { update } }));
afterEach(() => {
  vi.resetModules();
  update.mockReset();
  vi.useRealTimers();
});
it("flushes a pending location before desktop shutdown and awaits the server", async () => {
  vi.useFakeTimers();
  let acknowledge!: () => void;
  update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const { scheduleProgress, flushProgress } = await import("./progress");
  scheduleProgress(
    "book",
    {
      progress: { type: "epub", href: "chapter2.xhtml", progression: 0.5 },
      percentage: 0.4,
    },
    () => {},
  );
  let finished = false;
  const flush = flushProgress().then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledOnce();
  expect(finished).toBe(false);
  acknowledge();
  await flush;
  expect(finished).toBe(true);
});
it("serializes in-flight progress writes so an older position cannot win", async () => {
  vi.useFakeTimers();
  let first!: () => void;
  update
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          first = resolve;
        }),
    )
    .mockResolvedValue({});
  const { scheduleProgress, flushProgress } = await import("./progress");
  scheduleProgress(
    "pdf",
    { progress: { type: "pdf", page: 1 }, percentage: 0.1 },
    () => {},
  );
  const a = flushProgress();
  await vi.advanceTimersByTimeAsync(0);
  scheduleProgress(
    "pdf",
    { progress: { type: "pdf", page: 2 }, percentage: 0.2 },
    () => {},
  );
  const b = flushProgress();
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledTimes(1);
  first();
  await Promise.all([a, b]);
  expect(update.mock.calls[1][1].progress.page).toBe(2);
});
it("never retries an older failed location after a newer save succeeds", async () => {
  vi.useFakeTimers();
  let rejectFirst!: (error: Error) => void;
  update
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValue({});
  const { scheduleProgress, flushProgress } = await import("./progress");
  scheduleProgress(
    "pdf",
    { progress: { type: "pdf", page: 1 }, percentage: 0.1 },
    () => {},
  );
  const first = flushProgress().catch(() => {});
  await vi.advanceTimersByTimeAsync(0);
  scheduleProgress(
    "pdf",
    { progress: { type: "pdf", page: 2 }, percentage: 0.2 },
    () => {},
  );
  const second = flushProgress();
  rejectFirst(new Error("transient error"));
  await Promise.all([first, second]);
  expect(update.mock.calls.map((call) => call[1].progress.page)).toEqual([
    1, 2,
  ]);
});
