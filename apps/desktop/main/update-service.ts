import { app, BrowserWindow, dialog, net, shell } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DailyUpdateChecker, type UpdateState } from "./updates";
import { downloadUpdate } from "./update-download";

export async function startUpdateService(window: BrowserWindow) {
  const directory = app.getPath("userData");
  const statePath = join(directory, "update-state.json");
  let state: UpdateState = {};
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    for (const key of ["lastChecked", "lastAttempt"] as const) {
      if (
        typeof saved?.[key] === "number" &&
        Number.isFinite(saved[key]) &&
        saved[key] >= 0
      )
        state[key] = saved[key];
    }
  } catch {
    /* Missing or corrupt scheduler state is safe to replace. */
  }
  const checker = new DailyUpdateChecker({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    state,
    fetch: (url, init) => net.fetch(url, init),
    save: async (value) => {
      await mkdir(directory, { recursive: true });
      await writeFile(`${statePath}.tmp`, JSON.stringify(value), {
        mode: 0o600,
      });
      await rename(`${statePath}.tmp`, statePath);
    },
  });
  let active: Promise<void> | undefined;
  let stopped = false;
  let wantsFeedback = false;
  const alive = () => !stopped && !window.isDestroyed();
  const check = (manual = false): Promise<void> => {
    if (active) {
      wantsFeedback ||= manual;
      return active;
    }
    if (!alive() || (!manual && !checker.isDue())) return Promise.resolve();
    if (!app.isPackaged) {
      return manual
        ? dialog
            .showMessageBox(window, {
              message: "开发模式不检查更新",
              detail: "请在安装后的 Reader 中检查更新。",
            })
            .then(() => {})
        : Promise.resolve();
    }
    wantsFeedback = manual;
    active = (async () => {
      let downloading = false;
      try {
        const result = await checker.check();
        if (!alive()) return;
        if (result.status !== "available") {
          if (wantsFeedback || downloading)
            await dialog.showMessageBox(window, {
              message:
                result.status === "pending"
                  ? "新版本安装包正在准备中"
                  : "当前已是最新正式版",
              detail:
                result.status === "pending"
                  ? "安装包上传完成后会再次检查，你也可以稍后手动重试。"
                  : `当前版本：${app.getVersion()}`,
            });
          return;
        }
        const selected = await dialog.showMessageBox(window, {
          type: "info",
          message: `Reader ${result.update.version} 可用`,
          detail: `当前版本：${app.getVersion()}。下载并校验后将打开 DMG，请将 Reader 拖入 Applications 完成更新。安装前请退出当前 Reader。`,
          buttons: ["下载安装包", "稍后"],
          defaultId: 0,
          cancelId: 1,
        });
        if (selected.response !== 0 || !alive()) return;
        downloading = true;
        window.setProgressBar(2);
        const path = await downloadUpdate(
          result.update,
          join(directory, "updates"),
          (url, init) => net.fetch(url, init),
        );
        if (!alive()) return;
        const error = await shell.openPath(path);
        if (error) throw new Error(`无法打开安装包：${error}`);
      } catch (error) {
        if (alive()) {
          if (wantsFeedback || downloading)
            await dialog.showMessageBox(window, {
              type: "error",
              message: "无法完成更新",
              detail: error instanceof Error ? error.message : String(error),
            });
          else
            console.warn(
              "Reader update:",
              error instanceof Error ? error.message : String(error),
            );
        }
      }
    })().finally(() => {
      if (!window.isDestroyed()) window.setProgressBar(-1);
      active = undefined;
    });
    return active;
  };
  const initial = setTimeout(() => {
    void check();
  }, 15_000);
  const timer = setInterval(() => {
    void check();
  }, 60_000);
  initial.unref();
  timer.unref();
  return {
    check: () => check(true),
    stop: () => {
      stopped = true;
      clearTimeout(initial);
      clearInterval(timer);
    },
  };
}
