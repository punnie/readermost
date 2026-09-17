import type { Tree, TreeFeed } from "./types";

/**
 * Normalise text for comparison: lowercase, and with accents removed.
 *
 * This is what lets `politica` find **Política**. Miniflux cannot do it for
 * article bodies — its Postgres index keeps the accents — but feed names and
 * shared items are matched here, where both sides can be folded the same way.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    // Strip combining marks, which is what NFD separates accents into.
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** How well a name matches, lower being better. */
function rank(name: string, query: string): number | undefined {
  const folded = fold(name);
  if (!folded.includes(query)) return undefined;

  if (folded === query) return 0;
  if (folded.startsWith(query)) return 1;
  // A match at the start of any word beats one buried mid-word.
  if (new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(folded)) return 2;
  return 3;
}

export interface FeedMatch {
  feed: TreeFeed;
  /** The folder it lives in, for context in the results. */
  folder: string;
}

/**
 * Feeds whose name matches, best first.
 *
 * Runs over the tree already in the query cache, so results appear as the
 * reader types rather than after a round trip.
 */
export function matchFeeds(tree: Tree | undefined, query: string): FeedMatch[] {
  const needle = fold(query);
  if (!tree || needle.length === 0) return [];

  const matches: { match: FeedMatch; score: number }[] = [];

  for (const category of tree.categories) {
    for (const feed of category.feeds) {
      const score = rank(feed.title, needle);
      if (score !== undefined) {
        matches.push({ match: { feed, folder: category.title }, score });
      }
    }
  }

  return matches
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.match.feed.title.toLowerCase().localeCompare(b.match.feed.title.toLowerCase()),
    )
    .map((entry) => entry.match);
}

/**
 * Whether a query could plausibly have been meant with accents.
 *
 * Used to explain an empty article search: Miniflux's index is accent
 * sensitive, so a query typed without them can miss everything, and saying so
 * is the difference between a limitation and an apparent bug.
 */
export function mayNeedAccents(query: string): boolean {
  // If the reader already typed accents, the index is not the problem.
  if (query !== query.normalize("NFD").replace(/\p{Diacritic}/gu, "")) return false;
  // Only letters that carry accents in practice are worth mentioning.
  return /[aeiouc]/i.test(query);
}
