import { useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, type EntryQuery } from "./api";
import { sortQuery, type SortOrder } from "./sort";
import type { Entry, Selection } from "./types";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
}

export function useTree() {
  return useQuery({ queryKey: ["tree"], queryFn: api.tree });
}

/** Translates a sidebar selection into the entry query it implies. */
export function queryForSelection(selection: Selection, sort: SortOrder): EntryQuery {
  const base: EntryQuery = { limit: 100, ...sortQuery(sort) };

  switch (selection.kind) {
    case "unread":
      return { ...base, status: ["unread"] };
    case "starred":
      return { ...base, starred: true };
    case "category":
      return { ...base, categoryId: selection.id, status: ["unread", "read"] };
    case "feed":
      return { ...base, feedId: selection.id, status: ["unread", "read"] };
    case "all":
    default:
      return { ...base, status: ["unread", "read"] };
  }
}

export function useEntries(selection: Selection, sort: SortOrder) {
  const query = queryForSelection(selection, sort);
  return useQuery({
    // The sort is part of the key: a different order is a different request.
    queryKey: ["entries", selection, sort],
    queryFn: () => api.entries(query),
    enabled: selection.kind !== "shared",
  });
}

/**
 * Marks entries read or unread optimistically, rolling back if the server
 * rejects it. Snappy read state is most of what makes a reader feel fast.
 */
export function useSetStatus(selection: Selection, sort: SortOrder) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: "read" | "unread" }) =>
      api.setEntryStatus(ids, status),

    onMutate: async ({ ids, status }) => {
      const key = ["entries", selection, sort];
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

export function useToggleStar(selection: Selection, sort: SortOrder) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.toggleBookmark(id),

    onMutate: async (id) => {
      const key = ["entries", selection, sort];
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
