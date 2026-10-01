/// <reference types="vite/client" />

interface Window {
  readerDesktop?: {
    importFiles: () => Promise<void>;
    onBeforeClose: (callback: () => Promise<void>) => () => void;
    onLibraryChanged: (callback: () => void) => () => void;
  };
}
