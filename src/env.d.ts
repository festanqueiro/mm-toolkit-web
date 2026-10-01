/// <reference types="svelte" />
/// <reference types="vite/client" />

/** package.json version, injected at build time (single source of truth). */
declare const __APP_VERSION__: string;
/** Short git commit (+dirty) for non-release builds, else null. */
declare const __DEV_BUILD__: string | null;

// File System Access API (Chromium-only; not yet in TypeScript's DOM lib).
declare function showDirectoryPicker(options?: {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: FileSystemHandle | string;
}): Promise<FileSystemDirectoryHandle>;
