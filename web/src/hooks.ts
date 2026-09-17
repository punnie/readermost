import { useCallback, useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, type EntryQuery } from "./api";
import { sortQuery, type SortOrder } from "./sort";
import { statusesFor, type LengthFilter, type StatusFilter } from "./filters";
import type { Entry, Selection, Tree } from "./types";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
}

export function useTree() {
  return useQuery({ queryKey: ["tree"], queryFn: api.tree });
}

/** Translates a sidebar selection into the entry query it implies. */
export function queryForSelection(
  selection: Selection,
  sort: SortOrder,
  status: StatusFilter = "all",
  length: LengthFilter = "any",
): EntryQuery {
  // Miniflux cannot filter by reading time, so that pass happens on the client
  // over whatever was fetched. Pull a bigger window when it is active, or a
  // "long" filter on a news feed finds nothing in the first 100.
  const limit = length === "any" ? 100 : 200;
  const base: EntryQuery = { limit, ...sortQuery(sort) };

  switch (selection.kind) {
    case "unread":
      return { ...base, status: ["unread"] };
    case "starred":
      return { ...base, starred: true };
    case "category":
      return { ...base, categoryId: selection.id, status: statusesFor(status) };
    case "feed":
      return { ...base, feedId: selection.id, status: statusesFor(status) };
    case "all":
    default:
      return { ...base, status: ["unread", "read"] };
  }
}

export function useEntries(
  selection: Selection,
  sort: SortOrder,
  statusFilter: StatusFilter,
  lengthFilter: LengthFilter,
) {
  const query = queryForSelection(selection, sort, statusFilter, lengthFilter);
  return useQuery({
    // Sort and filters are part of the key: each combination is its own request.
    // The length filter is client-side but changes the fetch size, so it counts.
    queryKey: ["entries", selection, sort, statusFilter, lengthFilter],
    queryFn: () => api.entries(query),
    enabled: selection.kind !== "shared",
  });
}

/**
 * Marks entries read or unread optimistically, rolling back if the server
 * rejects it. Snappy read state is most of what makes a reader feel fast.
 */
export function useSetStatus(
  selection: Selection,
  sort: SortOrder,
  statusFilter: StatusFilter,
  lengthFilter: LengthFilter,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: "read" | "unread" }) =>
      api.setEntryStatus(ids, status),

    onMutate: async ({ ids, status }) => {
      const key = ["entries", selection, sort, statusFilter, lengthFilter];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);

      queryClient.setQueryData(key, (old: { entries: Entry[]; total: number } | undefined) => {
        if (!old) return old;
        const changed = new Set(ids);
        return {
          ...old,
          entries: old.entries.map((entry) =>
            changed.has(entry.id) ? { ...entry, status } : entry,
          ),
        };
      });

      return { previous, key };
    },

    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },

    onSettled: () => {
      // Unread badges live in a different query.
      void queryClient.invalidateQueries({ queryKey: ["tree"] });
    },
  });
}

export function useToggleStar(
  selection: Selection,
  sort: SortOrder,
  statusFilter: StatusFilter,
  lengthFilter: LengthFilter,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.toggleBookmark(id),

    onMutate: async (id) => {
      const key = ["entries", selection, sort, statusFilter, lengthFilter];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);

      queryClient.setQueryData(key, (old: { entries: Entry[]; total: number } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          entries: old.entries.map((entry) =>
            entry.id === id ? { ...entry, starred: !entry.starred } : entry,
          ),
        };
      });

      return { previous, key };
    },

    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },
  });
}

/**
 * Batches "mark read as it scrolls past" into one request.
 *
 * Without this, flicking through a folder with j fires a PUT per entry; with it,
 * a burst becomes a single call.
 */
export function useReadBatcher(onFlush: (ids: number[]) => void, delay = 800) {
  const pending = useRef<Set<number>>(new Set());
  const timer = useRef<number | undefined>(undefined);
  const callback = useRef(onFlush);

  useEffect(() => {
    callback.current = onFlush;
  }, [onFlush]);

  const flush = () => {
    if (pending.current.size === 0) return;
    const ids = [...pending.current];
    pending.current.clear();
    callback.current(ids);
  };

  useEffect(() => {
    // Anything still queued when the component goes away would otherwise be
    // silently dropped.
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (id: number) => {
    pending.current.add(id);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  };
}

/** Binds document-level shortcuts, ignoring keystrokes aimed at a text field. */
export function useKeyboard(handlers: Record<string, (event: KeyboardEvent) => void>) {
  const latest = useRef(handlers);

  useEffect(() => {
    latest.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const handler = latest.current[event.key];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Move a feed into another folder, optimistically.
 *
 * Shared by the sidebar's drag-and-drop and the Subscriptions dialog, so a feed
 * lands in the same place whichever way you drag it. The tree is rewritten
 * before the request goes out and reconciled with the server afterwards, so a
 * rejected move snaps back rather than leaving the tree lying.
 */
export function useMoveFeed() {
  const queryClient = useQueryClient();

  return useCallback(
    (feedID: number, categoryID: number) => {
      queryClient.setQueryData<Tree>(["tree"], (old) => {
        if (!old) return old;

        let moved: Tree["categories"][number]["feeds"][number] | undefined;
        const stripped = old.categories.map((category) => {
          const found = category.feeds.find((feed) => feed.id === feedID);
          if (!found) return category;
          moved = found;
          return {
            ...category,
            feeds: category.feeds.filter((feed) => feed.id !== feedID),
            unread: category.unread - found.unread,
          };
        });
        if (!moved) return old;

        return {
          ...old,
          categories: stripped.map((category) =>
            category.id === categoryID
              ? {
                  ...category,
                  feeds: [...category.feeds, moved!].sort((a, b) =>
                    a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
                  ),
                  unread: category.unread + moved!.unread,
                }
              : category,
          ),
        };
      });

      void api
        .updateFeed(feedID, { category_id: categoryID })
        .catch(() => {})
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: ["tree"] });
        });
    },
    [queryClient],
  );
}

/**
 * The unread count for whatever a selection points at.
 *
 * Shared by the toolbar and the refresh poll so both mean the same thing by
 * "did anything arrive".
 */
export function unreadForSelection(tree: Tree | undefined, selection: Selection): number | undefined {
  if (!tree) return undefined;

  switch (selection.kind) {
    case "feed":
      return tree.categories
        .flatMap((category) => category.feeds)
        .find((feed) => feed.id === selection.id)?.unread;
    case "category":
      return tree.categories.find((category) => category.id === selection.id)?.unread;
    case "starred":
      return 0;
    default:
      return tree.total_unread;
  }
}

/** Delays between checks after asking Miniflux to poll, in milliseconds. */
const REFRESH_CHECKS = [1500, 2500, 4000, 6000, 8000, 8000];

/**
 * Ask Miniflux to fetch, then keep looking until the results arrive.
 *
 * Miniflux answers a refresh request immediately and does the fetching in a
 * background process, so there is nothing useful to read when the call
 * returns — for seventy feeds the work can run for the better part of a
 * minute. Invalidating once, or once after a fixed pause, usually asks before
 * anything has changed and then never asks again, which is why refreshing
 * appeared to do nothing.
 *
 * So this polls on a widening schedule and stops as soon as the unread total
 * moves, or after about thirty seconds.
 */
export function useRefreshFeeds() {
  const queryClient = useQueryClient();
  /** What is being refreshed, so only that control shows progress. */
  const [refreshingWhat, setRefreshingWhat] = useState<Selection | undefined>();
  const abandoned = useRef(false);

  useEffect(
    () => () => {
      abandoned.current = true;
    },
    [],
  );

  const refresh = useCallback(
    async (selection: Selection) => {
      setRefreshingWhat(selection);

      const before = unreadForSelection(queryClient.getQueryData<Tree>(["tree"]), selection);

      try {
        if (selection.kind === "feed") {
          await api.refreshFeed(selection.id);
        } else if (selection.kind === "category") {
          await api.refreshCategory(selection.id);
        } else {
          await api.refreshAll();
        }

        for (const delay of REFRESH_CHECKS) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (abandoned.current) return;

          await queryClient.invalidateQueries({ queryKey: ["tree"] });
          const now = unreadForSelection(queryClient.getQueryData<Tree>(["tree"]), selection);

          // Something arrived in the thing that was refreshed.
          if (before !== undefined && now !== undefined && now !== before) break;
        }
      } catch {
        // A failed refresh is not worth an error dialog; the reader can retry.
      } finally {
        if (!abandoned.current) {
          // Whatever happened, leave the list and the counts current.
          await queryClient.invalidateQueries({ queryKey: ["entries"] });
          await queryClient.invalidateQueries({ queryKey: ["tree"] });
          setRefreshingWhat(undefined);
        }
      }
    },
    [queryClient],
  );

  return { refresh, refreshingWhat };
}

/**
 * A value that settles before it is used.
 *
 * Search runs on every keystroke; without this each one becomes a Miniflux
 * query over four thousand articles.
 */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
