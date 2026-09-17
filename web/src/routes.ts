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

export interface SearchRoute {
  query: string;
  /** Narrowed to one feed or folder, when the chip is on. */
  scope?: Selection;
}

export interface Route {
  selection: Selection;
  /** The open article, or the open shared post when the river is showing. */
  entryID?: number;
  postID?: string;
  /**
   * Present on /search. Deliberately not a Selection variant: making it one
   * would drag sort and filter preferences, prefKey and the toolbar into
   * meaning something for results, which they do not.
   */
  search?: SearchRoute;
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

    case "search":
      // Everything about a search lives in the query string; see routeFrom.
      return { selection: { kind: "unread" }, search: { query: "" } };

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

/** Encode a scope for the URL: feed:12, folder:5, or absent for everywhere. */
function encodeScope(scope: Selection | undefined): string | undefined {
  if (!scope) return undefined;
  if (scope.kind === "feed") return `feed:${scope.id}`;
  if (scope.kind === "category") return `folder:${scope.id}`;
  return undefined;
}

function decodeScope(raw: string | null): Selection | undefined {
  if (!raw) return undefined;
  const [kind, rawID] = raw.split(":");
  const id = parseID(rawID);
  if (!id) return undefined;
  if (kind === "feed") return { kind: "feed", id };
  if (kind === "folder") return { kind: "category", id };
  return undefined;
}

/**
 * Read a full location, path and query string together.
 *
 * Only /search carries query parameters, but reading them here keeps every
 * address in one place.
 */
export function routeFrom(pathname: string, search: string): Route {
  const route = routeFromPath(pathname);
  if (!route.search) return route;

  const params = new URLSearchParams(search);
  return {
    ...route,
    entryID: parseID(params.get("entry") ?? undefined),
    search: {
      query: params.get("q") ?? "",
      scope: decodeScope(params.get("in")),
    },
  };
}

/** The address for a search, so results are bookmarkable and reloadable. */
export function pathForSearch(
  query: string,
  scope?: Selection,
  entryID?: number,
): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);

  const encoded = encodeScope(scope);
  if (encoded) params.set("in", encoded);
  if (entryID) params.set("entry", String(entryID));

  const encodedParams = params.toString();
  return encodedParams ? `/search?${encodedParams}` : "/search";
}
