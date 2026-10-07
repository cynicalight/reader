/// <reference types="vite/client" />

interface Window {
  readerDesktop?: {
    platform: string;
    checkForUpdates: () => Promise<void>;
    writeClipboardText: (text: string) => Promise<void>;
    setAppearance: (appearance: "light" | "dark" | "system") => Promise<void>;
    importFiles: (library: "books" | "papers") => Promise<void>;
    onBeforeClose: (callback: () => Promise<void>) => () => void;
    onLibraryChanged: (callback: () => void) => () => void;
  };
}
