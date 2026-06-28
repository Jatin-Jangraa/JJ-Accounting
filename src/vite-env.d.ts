/// <reference types="vite/client" />

import type { AccountingApi } from './shared/ipc';

declare global {
  interface Window {
    accounting: AccountingApi;
    windowControls: {
      close(): void;
      minimize(): void;
      enterFullscreen(): void;
      exitFullscreen(): void;
      toggleFullscreen(): void;
      getState(): Promise<{ isFullscreen: boolean }>;
      onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
    };
  }
}
