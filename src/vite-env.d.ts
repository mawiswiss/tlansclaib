/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly TAURI_ENV_PLATFORM?: string;
}
