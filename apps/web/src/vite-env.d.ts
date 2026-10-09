/// <reference types="vite/client" />

interface Window {
  readerDesktop?: {
    platform: string;
    checkForUpdates: () => Promise<void>;
    writeClipboardText: (text: string) => Promise<void>;
    setAppearance: (
      appearance: "light" | "sepia" | "dark" | "system",
    ) => Promise<void>;
    /** Resolves with long papers that need the reader's confirmation. */
    importFiles: (
      library: "books" | "papers",
    ) => Promise<Array<{ id: string; name: string; pages: number }>>;
    importLargePapers: (
      ids: string[],
      library: "books" | "papers",
    ) => Promise<void>;
    showDocumentFile: (id: string, type: "pdf" | "epub") => Promise<void>;
    openDocumentFile: (id: string, type: "pdf" | "epub") => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    onOpenLink?: (
      callback: (target: import("@reader/core").ReaderLinkTarget) => void,
    ) => () => void;
    onBeforeClose: (callback: () => Promise<void>) => () => void;
    onLibraryChanged: (callback: () => void) => () => void;
  };
}
