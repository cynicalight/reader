import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("readerDesktop", {
  importFiles: () => ipcRenderer.invoke("reader:import"),
  onLibraryChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("reader:library-changed", listener);
    return () => ipcRenderer.removeListener("reader:library-changed", listener);
  },
});
