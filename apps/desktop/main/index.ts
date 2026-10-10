import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  nativeTheme,
  shell,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { annotationUndoShortcut } from "../../../packages/reader-core/src/undo-shortcut";
import { zoomCommand } from "../../../packages/reader-core/src/zoom-shortcut";
import {
  READER_SCHEME,
  parseReaderLink,
  type ReaderLinkTarget,
} from "../../../packages/reader-core/src/reader-link";
import { writeClipboardText } from "./clipboard";
import { childProxyEnvironment } from "./proxy";
import { startUpdateService } from "./update-service";
let updateService: Awaited<ReturnType<typeof startUpdateService>> | undefined;
let child: ChildProcess | undefined;
let serverURL = "";
let serverToken = "";
let window: BrowserWindow | undefined;
let quitting = false;
let closing = false;
let flushed = false;
const root = resolve(__dirname, "../..");
async function startServer() {
  let childEnv = { ...process.env };
  try {
    childEnv = await childProxyEnvironment(process.env);
  } catch {
    dialog.showErrorBox(
      "无法应用系统代理",
      "无法读取系统代理，或代理地址、自动配置、直连例外规则暂不受支持。本次保留原有网络环境，Agent 连接可能不可用。请检查手动系统代理后重启 Reader。",
    );
  }
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
        ...childEnv,
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
/** Window background before the renderer paints, matching the theme. */
function windowBackground(appearance: unknown) {
  if (appearance === "sepia") return "#eeede7";
  return nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff";
}
// Long papers wait for the reader's choice. The renderer refers to them by
// one-time IDs, never by path.
const largePapers = new Map<string, string>();
async function importPaths(
  paths: string[],
  library: "books" | "papers" = "books",
  allowLarge = false,
) {
  const accepted = library === "papers" ? /\.pdf$/i : /\.(epub|pdf)$/i;
  const large: Array<{ id: string; name: string; pages: number }> = [];
  for (const path of paths) {
    if (!accepted.test(path)) continue;
    const data = await readFile(path);
    const name = path.split(/[\\/]/).pop()!;
    const form = new FormData();
    form.append("library", library);
    if (allowLarge) form.append("allowLarge", "1");
    form.append("file", new Blob([data]), name);
    const response = await fetch(`${serverURL}/api/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serverToken}` },
      body: form,
    });
    if (!response.ok) {
      const failure = await response.json();
      if (failure.code !== "large-paper") throw new Error(failure.error);
      const id = randomBytes(16).toString("hex");
      largePapers.set(id, path);
      large.push({ id, name, pages: failure.pages });
    }
  }
  window?.webContents.send("reader:library-changed");
  return large;
}
// reader:// links reach one window. The renderer claims queued links once its
// listener exists; later links are sent directly.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
const pendingLinks: ReaderLinkTarget[] = [];
let linksClaimed = false;
function openLink(link: string) {
  const target = parseReaderLink(link);
  if (!target) return;
  if (linksClaimed && window && !window.isDestroyed()) {
    window.webContents.send("reader:open-link", target);
    if (window.isMinimized()) window.restore();
    window.focus();
  } else pendingLinks.push(target);
}
const linkArgument = (argv: string[]) =>
  argv.find((arg) => arg.toLowerCase().startsWith(`${READER_SCHEME}://`));
app.on("open-url", (event, link) => {
  event.preventDefault();
  openLink(link);
});
app.on("second-instance", (_event, argv) => {
  const link = linkArgument(argv);
  if (link) openLink(link);
  else if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
{
  const link = linkArgument(process.argv);
  if (link) openLink(link);
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
    if (!primary) return;
    // Development runs need the entry script registered beside Electron.
    if (process.defaultApp && process.argv.length >= 2)
      app.setAsDefaultProtocolClient(READER_SCHEME, process.execPath, [
        resolve(process.argv[1]),
      ]);
    else app.setAsDefaultProtocolClient(READER_SCHEME);
    const url = await startServer();
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        // Only Reader's own page may list installed fonts, for the
        // translation font picker; every other request stays denied.
        let origin = "";
        try {
          origin = new URL(details.requestingUrl).origin;
        } catch {
          /* not a URL */
        }
        callback(
          permission === "local-fonts" &&
            contents === window?.webContents &&
            origin === new URL(url).origin,
        );
      },
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
      appearance === "light" || appearance === "dark"
        ? appearance
        : appearance === "sepia"
          ? "light"
          : "system";
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
      backgroundColor: windowBackground(appearance),
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
    // Let the renderer handle reading shortcuts; editable fields keep native undo.
    window.webContents.on("before-input-event", (_event, input) => {
      window?.webContents.setIgnoreMenuShortcuts(
        input.type === "keyDown" &&
          (annotationUndoShortcut({
            key: input.key,
            metaKey: input.meta,
            ctrlKey: input.control,
            shiftKey: input.shift,
            altKey: input.alt,
            isComposing: input.isComposing,
          }) ||
            ((input.meta || input.control) &&
              !input.shift &&
              !input.alt &&
              input.key.toLowerCase() === "f") ||
            zoomCommand({
              key: input.key,
              code: input.code,
              metaKey: input.meta,
              ctrlKey: input.control,
              altKey: input.alt,
              isComposing: input.isComposing,
            }) !== null),
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
        appearance !== "sepia" &&
        appearance !== "dark" &&
        appearance !== "system"
      )
        throw new Error("Invalid appearance");
      // Paper is a light theme for native chrome with its own background.
      nativeTheme.themeSource = appearance === "sepia" ? "light" : appearance;
      window.setBackgroundColor(windowBackground(appearance));
    });
    ipcMain.handle(
      "reader:document-file",
      async (event, id: unknown, type: unknown, action: unknown) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("Invalid sender");
        // Only library-owned copies, addressed by content hash, can be reached.
        if (
          typeof id !== "string" ||
          !/^[0-9a-f]{32}$/.test(id) ||
          (type !== "pdf" && type !== "epub") ||
          (action !== "show" && action !== "open")
        )
          throw new Error("Invalid document");
        const file = join(
          app.getPath("userData"),
          "library",
          type === "pdf" ? "papers" : "books",
          `${id}.${type}`,
        );
        if (action === "show") shell.showItemInFolder(file);
        else {
          const error = await shell.openPath(file);
          if (error) throw new Error(error);
        }
      },
    );
    ipcMain.handle("reader:take-links", (event) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Invalid sender");
      linksClaimed = true;
      return pendingLinks.splice(0);
    });
    ipcMain.handle("reader:open-external", async (event, url: unknown) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Invalid sender");
      if (typeof url !== "string" || !/^https?:\/\//i.test(url))
        throw new Error("Invalid link");
      await shell.openExternal(new URL(url).toString());
    });
    ipcMain.handle("reader:choose-zotero-directory", async (event) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Invalid sender");
      const selected = await dialog.showOpenDialog(window, {
        title: "选择 Zotero 目录",
        properties: ["openDirectory"],
      });
      return selected.canceled ? null : selected.filePaths[0] || null;
    });
    ipcMain.handle("reader:import", async (event, library: unknown) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Invalid sender");
      if (library !== "books" && library !== "papers")
        throw new Error("Invalid library");
      const selected = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        filters:
          library === "papers"
            ? [{ name: "PDF", extensions: ["pdf"] }]
            : [{ name: "EPUB / PDF", extensions: ["epub", "pdf"] }],
      });
      return selected.canceled ? [] : importPaths(selected.filePaths, library);
    });
    ipcMain.handle(
      "reader:import-large",
      async (event, ids: unknown, library: unknown) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("Invalid sender");
        if (
          !Array.isArray(ids) ||
          (library !== "books" && library !== "papers")
        )
          throw new Error("Invalid import");
        const paths = ids.flatMap((id) => {
          const path = typeof id === "string" ? largePapers.get(id) : undefined;
          if (path) largePapers.delete(id);
          return path ? [path] : [];
        });
        await importPaths(paths, library, true);
      },
    );
    await window.loadURL(`${url}/#token=${serverToken}`);
    if (pendingFiles.length) await importPaths(pendingFiles.splice(0));
    updateService = await startUpdateService(window);
    ipcMain.handle("reader:check-updates", (event) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Invalid sender");
      return updateService?.check();
    });
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
  updateService?.stop();
  child?.kill();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => app.quit());
app.on("window-all-closed", () => app.quit());
