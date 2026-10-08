import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  dialog: vi.fn(),
  fetch: vi.fn(),
  download: vi.fn(),
  open: vi.fn(),
  rm: vi.fn(),
  inPlace: vi.fn(),
  stage: vi.fn(),
  quitAndInstall: vi.fn(),
  app: {
    quit: vi.fn(),
    isPackaged: true,
    getPath: (name: string) =>
      name === "exe"
        ? "/Applications/Reader.app/Contents/MacOS/Reader"
        : "/test/user-data",
    getVersion: () => "0.1.0",
  },
}));
vi.mock("electron", () => ({
  app: mocks.app,
  autoUpdater: { quitAndInstall: mocks.quitAndInstall },
  dialog: { showMessageBox: mocks.dialog },
  net: { fetch: mocks.fetch },
  shell: { openPath: mocks.open },
}));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.read,
  writeFile: mocks.write,
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: mocks.rm,
}));
vi.mock("./update-download", () => ({ downloadUpdate: mocks.download }));
vi.mock("./mac-squirrel", () => ({
  canUpdateInPlace: mocks.inPlace,
  stageUpdate: mocks.stage,
}));
import { startUpdateService } from "./update-service";
import { day } from "./updates";
let stop: (() => void) | undefined;
let assets: string[];
const window = {
  isDestroyed: () => false,
  setProgressBar: vi.fn(),
} as unknown as BrowserWindow;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(day * 10);
  vi.clearAllMocks();
  assets = [
    "Reader-0.2.0-mac-arm64.dmg",
    "Reader-0.2.0-win-x64.exe",
    "SHA256SUMS.txt",
  ];
  mocks.inPlace.mockResolvedValue(true);
  mocks.stage.mockResolvedValue(undefined);
  mocks.app.isPackaged = true;
  mocks.read.mockRejectedValue(new Error("missing"));
  mocks.dialog.mockResolvedValue({ response: 1 });
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      tag_name: "v0.2.0",
      draft: false,
      prerelease: false,
      assets: assets.map((name) => ({
        name,
        state: "uploaded",
        browser_download_url: `https://github.com/cynicalight/reader/releases/download/v0.2.0/${name}`,
      })),
    }),
  );
  vi.stubGlobal("process", { ...process, platform: "darwin", arch: "arm64" });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("checks on startup, coalesces manual checks, and does not prompt again within a day", async () => {
  const service = await startUpdateService(window);
  stop = service.stop;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.dialog).toHaveBeenCalledTimes(1);
  expect(mocks.download).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(day - 60_000);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await Promise.all([service.check(), service.check()]);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.dialog).toHaveBeenCalledTimes(2);
});
it("respects persisted check times and stops scheduled work", async () => {
  mocks.read.mockResolvedValue(JSON.stringify({ lastChecked: day * 10 }));
  const service = await startUpdateService(window);
  stop = service.stop;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.fetch).not.toHaveBeenCalled();
  service.stop();
  await vi.advanceTimersByTimeAsync(day * 2);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("opens only verified downloads and reports download failures even after a background prompt", async () => {
  mocks.dialog.mockResolvedValue({ response: 0 });
  mocks.download.mockRejectedValueOnce(new Error("安装包完整性校验失败"));
  const service = await startUpdateService(window);
  stop = service.stop;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.dialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({ type: "error", detail: "安装包完整性校验失败" }),
  );
  mocks.download.mockResolvedValue("/test/verified.dmg");
  mocks.open.mockResolvedValue("");
  await service.check();
  expect(mocks.open).toHaveBeenCalledWith("/test/verified.dmg");
  expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
});
it("keeps a Mac running after opening the DMG", async () => {
  mocks.dialog.mockResolvedValue({ response: 0 });
  mocks.download.mockResolvedValue("/test/verified.dmg");
  mocks.open.mockResolvedValue("");
  const service = await startUpdateService(window);
  stop = service.stop;
  await service.check();
  expect(mocks.open).toHaveBeenCalledWith("/test/verified.dmg");
  expect(mocks.app.quit).not.toHaveBeenCalled();
});
it("runs the verified Windows installer and then quits so files can be replaced", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32", arch: "x64" });
  mocks.dialog.mockResolvedValue({ response: 0 });
  mocks.download.mockResolvedValue("C:\\test\\Reader-0.2.0-win-x64.exe");
  mocks.open.mockResolvedValue("");
  const service = await startUpdateService(window);
  stop = service.stop;
  await service.check();
  expect(mocks.download).toHaveBeenCalledWith(
    expect.objectContaining({ installer: "Reader-0.2.0-win-x64.exe" }),
    expect.any(String),
    expect.any(Function),
  );
  expect(mocks.open).toHaveBeenCalledWith("C:\\test\\Reader-0.2.0-win-x64.exe");
  expect(mocks.app.quit).toHaveBeenCalledTimes(1);
  mocks.open.mockResolvedValue("Access denied");
  await service.check();
  expect(mocks.app.quit).toHaveBeenCalledTimes(1);
});
it("stages a signed Mac update silently and installs it on restart", async () => {
  assets.push("Reader-0.2.0-mac-arm64.zip");
  mocks.download.mockResolvedValue("/test/user-data/updates/x/Reader.zip");
  mocks.dialog.mockResolvedValue({ response: 0 });
  const service = await startUpdateService(window);
  stop = service.stop;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.inPlace).toHaveBeenCalledWith("/Applications/Reader.app");
  expect(mocks.download).toHaveBeenCalledWith(
    expect.objectContaining({
      installer: "Reader-0.2.0-mac-arm64.zip",
      downloadURL:
        "https://github.com/cynicalight/reader/releases/download/v0.2.0/Reader-0.2.0-mac-arm64.zip",
    }),
    "/test/user-data/updates",
    expect.any(Function),
  );
  expect(mocks.stage).toHaveBeenCalledWith(
    expect.anything(),
    "/test/user-data/updates/x/Reader.zip",
  );
  expect(mocks.rm).toHaveBeenCalledWith("/test/user-data/updates/x", {
    recursive: true,
    force: true,
  });
  // The background check asks nothing before the update is ready.
  expect(mocks.dialog).toHaveBeenCalledTimes(1);
  expect(mocks.dialog).toHaveBeenCalledWith(
    window,
    expect.objectContaining({ message: "Reader 0.2.0 已准备就绪" }),
  );
  expect(window.setProgressBar).not.toHaveBeenCalledWith(2);
  expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1);
  expect(mocks.open).not.toHaveBeenCalled();
  // A staged version is not downloaded again before the restart.
  await service.check();
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.dialog).toHaveBeenCalledTimes(2);
});
it("falls back to the DMG when the app cannot replace itself", async () => {
  assets.push("Reader-0.2.0-mac-arm64.zip");
  mocks.inPlace.mockResolvedValue(false);
  const service = await startUpdateService(window);
  stop = service.stop;
  await service.check();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.dialog).toHaveBeenCalledWith(
    window,
    expect.objectContaining({ buttons: ["下载安装包", "稍后"] }),
  );
  mocks.inPlace.mockResolvedValue(true);
  mocks.download.mockResolvedValue("/test/user-data/updates/x/Reader.zip");
  mocks.stage.mockRejectedValue(
    new Error("Code signature did not pass validation"),
  );
  await service.check();
  expect(mocks.rm).toHaveBeenCalled();
  expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  expect(mocks.dialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({ buttons: ["下载安装包", "稍后"] }),
  );
});
it("does not contact GitHub in development mode", async () => {
  mocks.app.isPackaged = false;
  const service = await startUpdateService(window);
  stop = service.stop;
  await vi.advanceTimersByTimeAsync(15_000);
  await service.check();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.dialog).toHaveBeenCalledWith(
    window,
    expect.objectContaining({ message: "开发模式不检查更新" }),
  );
});
