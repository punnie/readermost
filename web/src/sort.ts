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
  switch (selection.kind) {
    case "feed":
      return `sort:feed:${selection.id}`;
    case "category":
      return `sort:category:${selection.id}`;
    default:
      return `sort:view:${selection.kind}`;
  }
}

function isSortOrder(value: unknown): value is SortOrder {
  return value === "newest" || value === "oldest" || value === "magic";
}

/**
 * Read a remembered order.
 *
 * localStorage throws outright in some contexts — a private window, a browser
 * set to block site data — so every access is guarded and falls back to the
 * default rather than taking the app down with it.
 */
export function readSort(selection: Selection): SortOrder {
  try {
    const stored = window.localStorage.getItem(sortKey(selection));
    return isSortOrder(stored) ? stored : "newest";
  } catch {
    return "newest";
  }
}

export function writeSort(selection: Selection, order: SortOrder): void {
  try {
    window.localStorage.setItem(sortKey(selection), order);
  } catch {
    // A preference that cannot be saved is not worth an error; the session
    // still honours the choice.
  }
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
