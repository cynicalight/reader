/// <reference types="vite/client" />

interface Window {
  readerDesktop?: {
    setAppearance: (appearance: "light" | "dark" | "system") => Promise<void>;
    importFiles: () => Promise<void>;
    onBeforeClose: (callback: () => Promise<void>) => () => void;
    onLibraryChanged: (callback: () => void) => () => void;
  };
}
