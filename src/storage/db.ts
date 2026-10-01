/** Minimal promise wrapper over the app's IndexedDB database (spec 11). */

export const DB_NAME = "mm-toolkit";
const DB_VERSION = 1;
export type StoreName = "settings" | "history" | "handles";

let opening: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ["settings", "history", "handles"] as const) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading or deleting the database: let it proceed, reconnect lazily.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

/** Test hook: close and forget the cached connection. */
export async function resetDbForTests(): Promise<void> {
  const pending = opening;
  opening = null;
  if (pending) (await pending.catch(() => null))?.close();
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return request(run(db.transaction(store, mode).objectStore(store)));
}

export const dbGet = <T>(store: StoreName, key: IDBValidKey) => tx<T | undefined>(store, "readonly", (s) => s.get(key));
export const dbSet = (store: StoreName, key: IDBValidKey, value: unknown) => tx(store, "readwrite", (s) => s.put(value, key));
export const dbDelete = (store: StoreName, key: IDBValidKey) => tx(store, "readwrite", (s) => s.delete(key));
export const dbClear = (store: StoreName) => tx(store, "readwrite", (s) => s.clear());

export async function dbEntries<T>(store: StoreName): Promise<Array<[IDBValidKey, T]>> {
  const [keys, values] = await Promise.all([
    tx(store, "readonly", (s) => s.getAllKeys()),
    tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  ]);
  return keys.map((key, i) => [key, values[i]!]);
}
