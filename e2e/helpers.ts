import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";

/** Read a value from the app's IndexedDB `settings` store. */
export const storedSetting = (page: Page, key: string) =>
  page.evaluate(
    (key) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("mm-toolkit");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("settings").objectStore("settings").get(key);
          get.onsuccess = () => {
            db.close();
            resolve(get.result);
          };
          get.onerror = () => reject(get.error);
        };
      }),
    key,
  );

/** Wait until a setting is persisted, so a reload can't race the IndexedDB write. */
export const waitForStored = (page: Page, key: string, value: unknown) => expect.poll(() => storedSetting(page, key)).toEqual(value);

/**
 * Chromium exports into a folder: back the picker with an OPFS directory the test can read.
 * Caveat: Chromium 153 crashes the whole browser when an OPFS directory handle is read back
 * from IndexedDB, so tests must not reload and then resolve this folder (real users' folders
 * come from the picker, not OPFS, and aren't affected). Same-session lookups use the live cache.
 */
export async function mockFolderPicker(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle("exports-test", { create: true });
  });
}

/** Bytes of an exported file in the mocked OPFS folder (Chromium). */
export const opfsFile = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("exports-test");
    const file = await (await dir.getFileHandle(name)).getFile();
    let binary = "";
    for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, name);

export const opfsNames = (page: Page) =>
  page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("exports-test", { create: true });
    const names: string[] = [];
    for await (const key of (dir as unknown as { keys: () => AsyncIterable<string> }).keys()) names.push(key);
    return names.sort();
  });

export async function probe(bytes: Uint8Array) {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  return {
    duration: await input.computeDuration(),
    width: video?.displayWidth,
    height: video?.displayHeight,
    videoCodec: video?.codec ?? null,
    audio: audio ? { channels: audio.numberOfChannels, sampleRate: audio.sampleRate, codec: audio.codec } : null,
  };
}

/** Every record in the app's IndexedDB `history` store. */
export const historyRecords = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const open = indexedDB.open("mm-toolkit");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction("history").objectStore("history").getAll();
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result as Array<Record<string, unknown>>);
          };
        };
      }),
  );

/**
 * Serve the production build from a server this test can switch off: a real "network gone",
 * unlike Playwright's offline emulation and routing, which bypass or break service workers
 * in Chromium and WebKit.
 */
/**
 * `transform(path, body)` may rewrite a response (e.g. a stale index.html or a newer sw.js).
 */
export async function serveDist(
  transform: (path: string, body: Buffer) => Buffer = (_path, body) => body,
): Promise<{ origin: string; stop: () => Promise<void> }> {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
  };
  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(transform(path, readFileSync(file)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
