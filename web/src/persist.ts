import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { clear, del, get, set } from "idb-keyval";

/**
 * Where the reader keeps what it has already fetched, so the app still has
 * something to show with no network.
 *
 * IndexedDB rather than localStorage: entry HTML runs to megabytes, well past
 * the 5 MB localStorage ceiling.
 */
const CACHE_KEY = "readermost-query-cache";

/**
 * How long to wait on IndexedDB before giving up on it.
 *
 * This matters more than it looks. The app does not render until the cache has
 * been restored, so an IndexedDB that never answers is an app that never
 * starts — and that is a real configuration, not a hypothetical: private
 * browsing and blocked site data can leave the request hanging rather than
 * failing. Caching is an optimisation and must never be a gate.
 */
const STORAGE_TIMEOUT = 3000;

let degraded = false;

/** True once storage has proved unusable, so the app can say so if it wants. */
export function storageUnavailable(): boolean {
  return degraded;
}

export function withTimeout<T>(operation: Promise<T>, fallback: T, what: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      if (!degraded) {
        degraded = true;
        console.warn(`readermost: ${what} timed out; offline caching is disabled`);
      }
      resolve(fallback);
    }, STORAGE_TIMEOUT);

    operation
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        degraded = true;
        resolve(fallback);
      });
  });
}

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => withTimeout(get<string>(key).then((v) => v ?? null), null, "reading the cache"),
    setItem: (key, value) => withTimeout(set(key, value), undefined, "writing the cache"),
    removeItem: (key) => withTimeout(del(key), undefined, "clearing the cache"),
  },
  key: CACHE_KEY,
  throttleTime: 2000,
});

/**
 * Forget everything cached on this device.
 *
 * Called on sign-out. Without it, the next person to open the app in this
 * browser profile gets the previous user's articles and discussions — the cache
 * outlives the session cookie.
 */
export async function clearPersistedCache(): Promise<void> {
  try {
    await persister.removeClient();
    await withTimeout(clear(), undefined, "clearing the cache");
  } catch {
    // Storage can be unavailable or already gone; sign-out must not hang on it.
  }
}
