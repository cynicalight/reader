import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("readerDesktop", {
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke("reader:check-updates"),
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
  setAppearance: (appearance: "light" | "sepia" | "dark" | "system") =>
    ipcRenderer.invoke("reader:appearance", appearance),
  chooseZoteroDirectory: () =>
    ipcRenderer.invoke("reader:choose-zotero-directory"),
  importFiles: (library: "books" | "papers") =>
    ipcRenderer.invoke("reader:import", library),
  importLargePapers: (ids: string[], library: "books" | "papers") =>
    ipcRenderer.invoke("reader:import-large", ids, library),
  showDocumentFile: (id: string, type: "pdf" | "epub") =>
    ipcRenderer.invoke("reader:document-file", id, type, "show"),
  openDocumentFile: (id: string, type: "pdf" | "epub") =>
    ipcRenderer.invoke("reader:document-file", id, type, "open"),
  openExternal: (url: string) =>
    ipcRenderer.invoke("reader:open-external", url),
  onOpenLink: (callback: (target: unknown) => void) => {
    const listener = (_event: unknown, target: unknown) => callback(target);
    ipcRenderer.on("reader:open-link", listener);
    // Links that arrived before this listener are delivered once.
    void ipcRenderer
      .invoke("reader:take-links")
      .then((targets: unknown[]) => targets.forEach(callback));
    return () => ipcRenderer.removeListener("reader:open-link", listener);
  },
  onLibraryChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("reader:library-changed", listener);
    return () => ipcRenderer.removeListener("reader:library-changed", listener);
  },
});
