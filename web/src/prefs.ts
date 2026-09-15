/**
 * Per-feed display preferences, kept in the browser.
 *
 * Miniflux has no per-feed sort or filter fields, so remembering a choice is
 * ours to do. localStorage throws outright in some contexts — a private
 * window, a browser set to block site data — so every access is guarded and
 * falls back rather than taking the reader down.
 */
import type { Selection } from "./types";

/** A stable key per feed, folder or view, so each remembers its own choices. */
export function prefKey(name: string, selection: Selection): string {
  switch (selection.kind) {
    case "feed":
      return `${name}:feed:${selection.id}`;
    case "category":
      return `${name}:category:${selection.id}`;
    default:
      return `${name}:view:${selection.kind}`;
  }
}

export function readPref<T extends string>(
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): T {
  try {
    const stored = window.localStorage.getItem(key);
    return isValid(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be saved is not worth an error; the session
    // still honours the choice.
  }
}
