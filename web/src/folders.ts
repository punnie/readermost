/**
 * Folder housekeeping shared by the sidebar, the Subscriptions dialog and the
 * delete-folder dialog: which folders are collapsed, and where a deleted
 * folder's feeds should go.
 */
import { useCallback, useSyncExternalStore } from "react";

import type { Tree, TreeCategory } from "./types";

const COLLAPSED_KEY = "collapsed-folders";

/** Reads the stored list leniently: anything unexpected means "none collapsed". */
export function parseCollapsed(raw: string | null): Set<number> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is number => Number.isInteger(id) && id > 0));
  } catch {
    return new Set();
  }
}

export function serializeCollapsed(collapsed: Set<number>): string {
  return JSON.stringify([...collapsed].sort((a, b) => a - b));
}

/**
 * One store for the whole app, so collapsing a folder in the Subscriptions
 * dialog collapses it in the sidebar too, and the choice survives a reload.
 * localStorage throws in some contexts, so every access is guarded; the
 * session still honours the choice when it cannot be saved.
 */
function load(): Set<number> {
  try {
    return parseCollapsed(window.localStorage.getItem(COLLAPSED_KEY));
  } catch {
    return new Set();
  }
}

let collapsed: Set<number> | undefined;
const listeners = new Set<() => void>();

function snapshot(): Set<number> {
  collapsed ??= load();
  return collapsed;
}

function publish(next: Set<number>) {
  collapsed = next;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, serializeCollapsed(next));
  } catch {
    // Not worth an error; see above.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  // Another tab collapsing a folder is the same reader's choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLLAPSED_KEY) return;
    collapsed = parseCollapsed(event.newValue);
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCollapsedFolders() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  const toggle = useCallback((categoryID: number) => {
    const next = new Set(snapshot());
    if (next.has(categoryID)) next.delete(categoryID);
    else next.add(categoryID);
    publish(next);
  }, []);

  /** Collapse or expand every folder at once. */
  const setAll = useCallback((categoryIDs: number[], collapse: boolean) => {
    publish(collapse ? new Set(categoryIDs) : new Set());
  }, []);

  return { collapsed: current, toggle, setAll };
}

/**
 * Where a deleted folder's feeds land unless the reader picks somewhere else:
 * the oldest remaining folder, matching the server's own default.
 */
export function defaultMoveTarget(
  tree: Tree | undefined,
  excluding: number,
): TreeCategory | undefined {
  return otherFolders(tree, excluding)[0];
}

/** Every folder but one, oldest first. */
export function otherFolders(tree: Tree | undefined, excluding: number): TreeCategory[] {
  return (tree?.categories ?? [])
    .filter((category) => category.id !== excluding)
    .sort((a, b) => a.id - b.id);
}
