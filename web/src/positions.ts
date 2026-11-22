/**
 * Where the reader left off in recently opened articles.
 *
 * A fixed-size, most-recent-first list of (article, scroll offset) pairs. An
 * article opened again while it is still on the list returns to where it was
 * left; anything new, or long enough ago to have dropped off the end, opens at
 * the top. Kept in localStorage so it survives a reload, guarded because
 * localStorage throws in some contexts — losing a position is never worth an
 * error.
 */
import { useLayoutEffect, useRef } from "react";

const STORAGE_KEY = "reading-positions";

/** How many articles to remember. Enough for a sitting, small enough to forget. */
export const POSITION_LIMIT = 100;

export type Positions = [key: string, y: number][];

/** Reads the stored list leniently: anything malformed is simply forgotten. */
export function parsePositions(raw: string | null): Positions {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (pair): pair is [string, number] =>
          Array.isArray(pair) &&
          typeof pair[0] === "string" &&
          typeof pair[1] === "number" &&
          Number.isFinite(pair[1]) &&
          pair[1] >= 0,
      )
      .slice(0, POSITION_LIMIT);
  } catch {
    return [];
  }
}

/** Records a position, moving the article to the front and dropping the oldest. */
export function remember(
  positions: Positions,
  key: string,
  y: number,
  limit = POSITION_LIMIT,
): Positions {
  const rest = positions.filter(([k]) => k !== key);
  return [[key, Math.max(0, Math.round(y))] as [string, number], ...rest].slice(0, limit);
}

export function recall(positions: Positions, key: string): number {
  return positions.find(([k]) => k === key)?.[1] ?? 0;
}

let cache: Positions | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

function load(): Positions {
  if (!cache) {
    try {
      cache = parsePositions(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      cache = [];
    }
  }
  return cache;
}

function flush() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (!cache) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: the session still remembers.
  }
}

if (typeof window !== "undefined") {
  // A scroll followed straight away by closing the tab should still count.
  window.addEventListener("pagehide", flush);
}

export function savedPosition(key: string): number {
  return recall(load(), key);
}

export function savePosition(key: string, y: number): void {
  const current = load();
  if (current[0]?.[0] === key && current[0][1] === Math.round(y)) return;
  cache = remember(current, key, y);
  // Scroll events arrive by the dozen; storage only needs the last of them.
  if (writeTimer === undefined) writeTimer = setTimeout(flush, 500);
}

/** Forget every position, e.g. on sign-out. */
export function forgetPositions(): void {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  cache = [];
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

/** The element that actually scrolls: the pane itself, or on a phone its scroller. */
function scrollParent(element: HTMLElement): HTMLElement | undefined {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return undefined;
}

/** How long to keep trying to reach a saved position while content loads in. */
const RESTORE_WINDOW = 4000;

/**
 * Keeps an article pane's scroll position in step with the list above.
 *
 * Attach the returned ref to the pane. Whenever `key` changes the pane jumps
 * to the saved position for it, or to the top. Content often arrives after the
 * article opens — the body is fetched, images load — so a saved position that
 * is not reachable yet is retried as the pane grows, until it is reached, the
 * reader scrolls themselves, or a few seconds pass.
 */
export function useReadingPosition<T extends HTMLElement>(key: string | undefined) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const pane = ref.current;
    if (!pane || key === undefined) return;
    const scroller = scrollParent(pane);
    if (!scroller) return;

    const target = savedPosition(key);
    let pending = target > 0;
    scroller.scrollTop = target;

    const settle = () => {
      if (!pending) return;
      scroller.scrollTop = target;
      if (Math.abs(scroller.scrollTop - target) < 2) stop();
    };
    const stop = () => {
      pending = false;
      observer?.disconnect();
      clearTimeout(timeout);
    };

    const observer =
      pending && typeof ResizeObserver !== "undefined" ? new ResizeObserver(settle) : undefined;
    observer?.observe(pane);
    const timeout = pending ? setTimeout(stop, RESTORE_WINDOW) : undefined;
    settle();

    // Anything the reader does to the pane takes over from the restore.
    const interrupt = () => stop();
    const onScroll = () => {
      // While restoring, the browser clamps the offset to what has loaded so
      // far; saving that would overwrite the real position with a short one.
      if (!pending) savePosition(key, scroller.scrollTop);
    };

    const inputs = ["wheel", "touchstart", "pointerdown"] as const;
    inputs.forEach((type) => scroller.addEventListener(type, interrupt, { passive: true }));
    // Keys scroll the pane without the pane having focus, so listen wider.
    window.addEventListener("keydown", interrupt);
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      stop();
      inputs.forEach((type) => scroller.removeEventListener(type, interrupt));
      window.removeEventListener("keydown", interrupt);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  return ref;
}

/** Exposed for tests: drop the in-memory copy so the next read hits storage. */
export function resetPositionCacheForTests(): void {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  cache = undefined;
}
