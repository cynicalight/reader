import { describe, expect, it, vi } from "vitest";
import {
  checkDue,
  DailyUpdateChecker,
  day,
  installerChecksum,
  newerRelease,
  retryDelay,
  selectRelease,
} from "./updates";
function release(version = "0.2.0") {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [`Reader-${version}-mac-arm64.dmg`, "SHA256SUMS.txt"].map(
      (name) => ({
        name,
        state: "uploaded",
        browser_download_url: `https://github.com/cynicalight/reader/releases/download/v${version}/${name}`,
      }),
    ),
  };
}
describe("release boundaries", () => {
  it("compares versions numerically and never downgrades", () => {
    expect(newerRelease("v0.10.0", "0.9.0")).toBe(true);
    expect(newerRelease("v0.2.0", "0.2.0-beta.1")).toBe(true);
    expect(newerRelease("v0.2.0", "0.2.0")).toBe(false);
    expect(newerRelease("v0.2.0", "1.0.0")).toBe(false);
    expect(() => newerRelease("garbage", "0.1.0")).toThrow();
  });
  it("requires stable releases and official matching assets", () => {
    expect(selectRelease(release(), "0.1.0", "darwin", "arm64").status).toBe(
      "available",
    );
    expect(selectRelease(release(), "0.2.0", "darwin", "arm64").status).toBe(
      "current",
    );
    expect(() =>
      selectRelease(
        { ...release(), prerelease: true },
        "0.1.0",
        "darwin",
        "arm64",
      ),
    ).toThrow();
    expect(() => selectRelease(release(), "0.1.0", "darwin", "x64")).toThrow();
    const bad = release();
    bad.assets[0].browser_download_url = "https://example.com/payload.dmg";
    expect(() => selectRelease(bad, "0.1.0", "darwin", "arm64")).toThrow();
  });
  it("retries a release whose build assets are not ready", () => {
    expect(
      selectRelease({ ...release(), assets: [] }, "0.1.0", "darwin", "arm64")
        .status,
    ).toBe("pending");
  });
  it("requires exactly one matching SHA256", () => {
    const hash = "a".repeat(64);
    const line = `${hash}  Reader.dmg`;
    expect(installerChecksum(line, "Reader.dmg")).toBe(hash);
    expect(() => installerChecksum(line, "Other.dmg")).toThrow();
    expect(() => installerChecksum(`${line}\n${line}`, "Reader.dmg")).toThrow();
  });
});
describe("daily scheduling", () => {
  it("persists the daily interval across restarts and handles clock rollback", () => {
    expect(checkDue({}, day)).toBe(true);
    expect(checkDue({ lastChecked: day }, day + 1)).toBe(false);
    expect(checkDue({ lastChecked: day }, day * 2)).toBe(true);
    expect(checkDue({ lastAttempt: day }, day + retryDelay - 1)).toBe(false);
    expect(checkDue({ lastChecked: day * 3 }, day)).toBe(true);
  });
  it("coalesces simultaneous checks and persists successful completion", async () => {
    const state = {};
    const save = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue(Response.json(release()));
    const checker = new DailyUpdateChecker({
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      state,
      save,
      fetch,
      now: () => day,
    });
    await Promise.all([checker.check(), checker.check()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ lastAttempt: day, lastChecked: day });
    expect(checker.isDue()).toBe(false);
  });
  it("does not mark failed or incomplete checks successful", async () => {
    const state = {};
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const checker = new DailyUpdateChecker({
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      state,
      save: async () => {},
      fetch,
      now: () => day,
    });
    await expect(checker.check()).rejects.toThrow("503");
    expect(state).toEqual({ lastAttempt: day });
    fetch.mockResolvedValue(Response.json({ ...release(), assets: [] }));
    expect((await checker.check()).status).toBe("pending");
    expect(state).toEqual({ lastAttempt: day });
  });
});
