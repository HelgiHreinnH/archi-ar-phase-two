/**
 * Phase 4 — Persistent asset cache (IndexedDB) for GLB + tracking files.
 *
 * Why IDB and not the HTTP cache?
 *   - Signed URLs change every visit (different `?token=…`), so the browser HTTP
 *     cache misses for the same underlying object.
 *   - We key by a stable identifier (`shareId + project.updated_at`) so a
 *     republish invalidates the cache cleanly.
 *
 * Tiny inline wrapper (no `idb-keyval` dep) to keep bundle weight down.
 */

const DB_NAME = "archi-ar-assets";
const DB_VERSION = 1;
const STORE = "assets";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[assetCache] IDB unavailable:", err);
    return null;
  }
}

interface CachedAsset {
  data: ArrayBuffer;
  cachedAt: number;
}

export async function getCachedAsset(key: string): Promise<ArrayBuffer | null> {
  const v = await withStore<CachedAsset | undefined>("readonly", (s) => s.get(key));
  return v?.data ?? null;
}

export async function setCachedAsset(key: string, data: ArrayBuffer): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (s) => s.put({ data, cachedAt: Date.now() } as CachedAsset, key));
}

export async function deleteCachedAsset(key: string): Promise<void> {
  await withStore<undefined>("readwrite", (s) => s.delete(key));
}

/** Build a stable cache key from share + asset role + an invalidation token. */
export function buildAssetKey(
  shareId: string,
  role: "model" | "tracking",
  invalidationToken: string,
): string {
  return `${shareId}::${role}::${invalidationToken}`;
}
