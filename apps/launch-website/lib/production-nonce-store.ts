import { mergeProductionNonceFloors, productionNonceFloorKey as key } from "./production-nonce";

type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const failure = () => new Error("Transaction recovery storage is unavailable. Keep the original wallet request.");

/** Existing journal operations run synchronously against a staged view. All tabs
 * serialize their consumed nonces in IndexedDB before a local journal can be
 * released. A stale WebKit localStorage replica may add evidence, never erase it. */
export async function withProductionNonceStore<T>(storage: JournalStorage, work: (view: JournalStorage) => T): Promise<T> {
  if (typeof window === "undefined" || storage !== window.localStorage) return work(storage);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("rmt-financial-recovery-4663", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("nonces");
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(failure());
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("nonces", "readwrite", { durability: "strict" });
      const store = tx.objectStore("nonces"), read = store.get(key);
      const changes = new Map<string, string | null>();
      let result: T;
      tx.onabort = tx.onerror = () => reject(failure());
      read.onsuccess = () => {
        try {
          changes.set(key, mergeProductionNonceFloors(read.result ?? null, storage.getItem(key)));
          const view: JournalStorage = {
            getItem: k => changes.has(k) ? changes.get(k)! : storage.getItem(k),
            setItem: (k, v) => { changes.set(k, v); },
            removeItem: k => { changes.set(k, null); },
          };
          result = work(view);
          const next = changes.get(key);
          if (!next || mergeProductionNonceFloors(next, read.result ?? null) !== next) throw failure();
          store.put(next, key);
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => {
        try {
          for (const [k, value] of changes) {
            if (value === null) storage.removeItem(k); else storage.setItem(k, value);
            if (storage.getItem(k) !== value) throw failure();
          }
          resolve(result);
        } catch (error) { reject(error); }
      };
    });
  } finally { db.close(); }
}
