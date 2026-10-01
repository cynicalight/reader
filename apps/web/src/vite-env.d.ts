/// <reference types="vite/client" />

interface Window {
  readerDesktop?: {
    importFiles: () => Promise<void>;
    onLibraryChanged: (callback: () => void) => () => void;
  };
}
