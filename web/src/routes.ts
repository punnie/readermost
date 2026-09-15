import type { Selection } from "./types";

/**
 * The mapping between the address bar and what the app is showing.
 *
 * Miniflux IDs are per user, so these are durable bookmarks for one account
 * rather than links to pass around — feed 12 is a different feed for everyone.
 * The exception is /shared/:postID: Mattermost post IDs are global, so that one
 * really does work for a friend.
 */

/** Where an unrecognised address lands. */
export const DEFAULT_ROUTE = "/unread";

export interface Route {
  selection: Selection;
  /** The open article, or the open shared post when the river is showing. */
  entryID?: number;
  postID?: string;
}

function parseID(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  // Number("") is 0 and Number("12abc") is NaN; both must be rejected.
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value > 0 ? value : undefined;
}

/**
 * Read a pathname. Anything unrecognised — a typo, a stale bookmark, a
 * malformed id — falls back to unread rather than showing an error.
 */
export function routeFromPath(pathname: string): Route {
  const segments = pathname.split("/").filter(Boolean);
  const [head, second, third] = segments;

  switch (head) {
    case undefined:
    case "unread":
      return { selection: { kind: "unread" }, entryID: parseID(second) };
    case "all":
      return { selection: { kind: "all" }, entryID: parseID(second) };
    case "starred":
      return { selection: { kind: "starred" }, entryID: parseID(second) };

    case "shared":
      // Post IDs are Mattermost's 26-character ids, not numbers.
      return { selection: { kind: "shared" }, postID: second || undefined };

    case "feed": {
      const id = parseID(second);
      if (!id) return { selection: { kind: "unread" } };
      return { selection: { kind: "feed", id }, entryID: parseID(third) };
    }

    case "folder": {
      const id = parseID(second);
      if (!id) return { selection: { kind: "unread" } };
      return { selection: { kind: "category", id }, entryID: parseID(third) };
    }

    default:
      return { selection: { kind: "unread" } };
  }
}

/** The address for a selection, optionally with an article open. */
export function pathFor(selection: Selection, open?: number | string): string {
  const suffix = open === undefined || open === "" ? "" : `/${open}`;

  switch (selection.kind) {
    case "all":
      return `/all${suffix}`;
    case "starred":
      return `/starred${suffix}`;
    case "shared":
      return `/shared${suffix}`;
    case "feed":
      return `/feed/${selection.id}${suffix}`;
    case "category":
      return `/folder/${selection.id}${suffix}`;
    case "unread":
    default:
      return `/unread${suffix}`;
  }
}

/** Do two selections point at the same thing? */
export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if ("id" in a && "id" in b) return a.id === b.id;
  return true;
}
