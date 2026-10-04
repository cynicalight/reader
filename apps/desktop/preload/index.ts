import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("readerDesktop", {
  platform: process.platform,
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke("reader:clipboard-write", text),
  onBeforeClose: (callback: () => Promise<void>) => {
    const listener = () => {
      void callback().then(
        () => ipcRenderer.send("reader:flushed", null),
        (error) => ipcRenderer.send("reader:flushed", String(error)),
      );
    };
    ipcRenderer.on("reader:flush", listener);
    return () => ipcRenderer.removeListener("reader:flush", listener);
  },
  setAppearance: (appearance: "light" | "dark" | "system") =>
    ipcRenderer.invoke("reader:appearance", appearance),
  importFiles: () => ipcRenderer.invoke("reader:import"),
  onLibraryChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("reader:library-changed", listener);
    return () => ipcRenderer.removeListener("reader:library-changed", listener);
  },
});
