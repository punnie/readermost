import { prefKey, readPref, writePref } from "./prefs";
import type { Selection } from "./types";

/**
 * How an entry list is ordered.
 *
 * Miniflux orders by id, status, published_at, category_title or category_id —
 * there is no random option, and no per-feed sort field. So "magic" is ours to
 * do, and so is remembering the choice.
 */
export type SortOrder = "newest" | "oldest" | "magic";

export const SORT_LABELS: Record<SortOrder, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  magic: "Magic (shuffled)",
};

/** Maps a sort order onto the query parameters Miniflux understands. */
export function sortQuery(order: SortOrder): { order: string; direction: "asc" | "desc" } {
  switch (order) {
    case "oldest":
      return { order: "published_at", direction: "asc" };
    case "magic":
      // Fetched newest-first and shuffled here; see shuffle below.
      return { order: "published_at", direction: "desc" };
    case "newest":
    default:
      return { order: "published_at", direction: "desc" };
  }
}

/** A stable key per feed, folder or view, so each remembers its own order. */
export function sortKey(selection: Selection): string {
  return prefKey("sort", selection);
}

function isSortOrder(value: unknown): value is SortOrder {
  return value === "newest" || value === "oldest" || value === "magic";
}

/** Read a remembered order, defaulting to newest. */
export function readSort(selection: Selection): SortOrder {
  return readPref(sortKey(selection), isSortOrder, "newest");
}

export function writeSort(selection: Selection, order: SortOrder): void {
  writePref(sortKey(selection), order);
}

/**
 * Deterministic shuffle.
 *
 * Seeded so a given list and seed always produce the same order: React
 * re-renders constantly, and an unseeded shuffle would reorder the list under
 * the reader's cursor every time anything changed.
 */
export function shuffle<T>(items: T[], seed: number): T[] {
  const shuffled = [...items];
  let state = seed || 1;

  const next = () => {
    // xorshift32 — small, fast, and good enough to mix a reading list.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state) / 2147483647;
  };

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
