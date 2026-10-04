import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  nativeTheme,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { zoomCommand } from "../../../packages/reader-core/src/zoom-shortcut";
import { writeClipboardText } from "./clipboard";
let child: ChildProcess | undefined;
let serverURL = "";
let serverToken = "";
let window: BrowserWindow | undefined;
let quitting = false;
let closing = false;
let flushed = false;
const root = resolve(__dirname, "../..");
async function startServer() {
  serverToken = randomBytes(32).toString("hex");
  const binary = app.isPackaged
    ? join(
        process.resourcesPath,
        "bin",
        process.platform === "win32" ? "reader-server.exe" : "reader-server",
      )
    : join(
        root,
        "desktop",
        "bin",
        process.platform === "win32" ? "reader-server.exe" : "reader-server",
      );
  const web = app.isPackaged
    ? join(process.resourcesPath, "web")
    : join(root, "web", "dist");
  const pathValue = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".kimi-code", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH,
  ]
    .filter(Boolean)
    .join(process.platform === "win32" ? ";" : ":");
  child = spawn(
    binary,
    [
      "--port",
      "0",
      "--data",
      join(app.getPath("userData"), "library"),
      "--web",
      web,
    ],
    {
      env: {
        ...process.env,
        READER_TOKEN: serverToken,
        PATH: pathValue,
        READER_NODE: process.execPath,
        READER_PROCESSOR: app.isPackaged
          ? join(process.resourcesPath, "processor", "main.mjs")
          : join(root, "processor", "dist", "main.mjs"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr?.on("data", (data) => process.stderr.write(data));
  return new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => {
      child?.kill();
      reject(new Error("本地服务启动超时"));
    }, 20000);
    child!.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child!.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`本地服务已退出 (${code})`));
      if (window && !quitting) {
        dialog.showErrorBox(
          "Reader 本地服务已停止",
          "请重新打开 Reader。已保存的文档和笔记仍保留在本地。",
        );
        app.quit();
      }
    });
    const lines = createInterface({ input: child!.stdout! });
    lines.once("line", (line) => {
      try {
        const ready = JSON.parse(line);
        serverURL = ready.url;
        clearTimeout(timer);
        lines.close();
        accept(serverURL);
      } catch {
        clearTimeout(timer);
        reject(new Error("本地服务返回了无效启动信息"));
      }
    });
  });
}
async function importPaths(paths: string[]) {
  for (const path of paths) {
    if (!/\.(epub|pdf)$/i.test(path)) continue;
    const data = await readFile(path);
    const form = new FormData();
    form.append("file", new Blob([data]), path.split(/[\\/]/).pop()!);
    const response = await fetch(`${serverURL}/api/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serverToken}` },
      body: form,
    });
    if (!response.ok) throw new Error((await response.json()).error);
  }
  window?.webContents.send("reader:library-changed");
}
const pendingFiles: string[] = [];
app.on("open-file", (event, path) => {
  event.preventDefault();
  if (serverURL)
    void importPaths([path]).catch((e) =>
      dialog.showErrorBox("导入失败", e.message),
    );
  else pendingFiles.push(path);
});
app
  .whenReady()
  .then(async () => {
    const url = await startServer();
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    const preferences: unknown = await fetch(`${url}/api/settings`, {
      headers: { Authorization: `Bearer ${serverToken}` },
    })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    const appearance =
      typeof preferences === "object" &&
      preferences !== null &&
      "appearance" in preferences
        ? preferences.appearance
        : undefined;
    nativeTheme.themeSource =
      appearance === "light" || appearance === "dark" ? appearance : "system";
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 1000,
      minHeight: 660,
      title: "Reader",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hidden" as const,
            trafficLightPosition: { x: 20, y: 20 },
          }
        : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.on("close", (event) => {
      if (flushed) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      window!.webContents.send("reader:flush");
      const timer = setTimeout(() => {
        void finish("保存超时，请重试。");
      }, 10000);
      const handler = (event: Electron.IpcMainEvent, error: string | null) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          return;
        void finish(error);
      };
      const finish = async (error: string | null) => {
        clearTimeout(timer);
        ipcMain.removeListener("reader:flushed", handler);
        if (error) {
          const result = await dialog.showMessageBox(window!, {
            type: "warning",
            message: "阅读数据尚未保存",
            detail: error,
            buttons: ["返回阅读", "仍然退出"],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response === 0) {
            closing = false;
            return;
          }
        }
        flushed = true;
        window?.close();
      };
      ipcMain.on("reader:flushed", handler);
    });
    // Let the renderer handle document zoom before Electron's View menu does.
    window.webContents.on("before-input-event", (_event, input) => {
      window?.webContents.setIgnoreMenuShortcuts(
        input.type === "keyDown" &&
          zoomCommand({
            key: input.key,
            code: input.code,
            metaKey: input.meta,
            ctrlKey: input.control,
            altKey: input.alt,
            isComposing: input.isComposing,
          }) !== null,
      );
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, target) => {
      if (new URL(target).origin !== url) event.preventDefault();
    });
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    ipcMain.handle("reader:clipboard-write", (event, text: unknown) =>
      writeClipboardText(event, text, window?.webContents, url),
    );
    ipcMain.handle("reader:appearance", (event, appearance: unknown) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Invalid sender");
      if (
        appearance !== "light" &&
        appearance !== "dark" &&
        appearance !== "system"
      )
        throw new Error("Invalid appearance");
      nativeTheme.themeSource = appearance;
      window.setBackgroundColor(
        nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
      );
    });
    ipcMain.handle("reader:import", async (event) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Invalid sender");
      const selected = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "EPUB / PDF", extensions: ["epub", "pdf"] }],
      });
      if (!selected.canceled) await importPaths(selected.filePaths);
    });
    await window.loadURL(`${url}/#token=${serverToken}`);
    if (pendingFiles.length) await importPaths(pendingFiles.splice(0));
  })
  .catch((error) => {
    dialog.showErrorBox("无法打开 Reader", String(error));
    app.quit();
  });
app.on("before-quit", (event) => {
  if (window && !window.isDestroyed() && !flushed) {
    event.preventDefault();
    window.close();
    return;
  }
  quitting = true;
  child?.kill();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => app.quit());
app.on("window-all-closed", () => app.quit());
