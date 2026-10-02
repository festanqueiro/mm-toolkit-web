import { expect, type Page } from "@playwright/test";

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
