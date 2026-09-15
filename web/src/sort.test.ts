import { afterEach, describe, expect, it, vi } from "vitest";

import { readSort, shuffle, sortKey, sortQuery, writeSort } from "./sort";
import type { Selection } from "./types";

/** A minimal localStorage, optionally one that throws like a locked-down browser. */
function stubStorage(throwing = false) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => {
      if (throwing) throw new Error("access denied");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (throwing) throw new Error("access denied");
      store.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sortQuery", () => {
  it("maps newest and oldest onto Miniflux's parameters", () => {
    expect(sortQuery("newest")).toEqual({ order: "published_at", direction: "desc" });
    expect(sortQuery("oldest")).toEqual({ order: "published_at", direction: "asc" });
  });

  it("fetches magic newest-first, because Miniflux cannot shuffle", () => {
    // The randomness is applied client-side; the request is an ordinary one.
    expect(sortQuery("magic")).toEqual({ order: "published_at", direction: "desc" });
  });
});

describe("sortKey", () => {
  it("gives every feed, folder and view its own key", () => {
    const keys = new Set([
      sortKey({ kind: "feed", id: 1, title: "a" }),
      sortKey({ kind: "feed", id: 2, title: "b" }),
      sortKey({ kind: "category", id: 1, title: "c" }),
      sortKey({ kind: "unread" }),
      sortKey({ kind: "starred" }),
    ]);
    expect(keys.size).toBe(5);
  });

  it("does not confuse a feed with a folder of the same id", () => {
    expect(sortKey({ kind: "feed", id: 3, title: "x" })).not.toBe(
      sortKey({ kind: "category", id: 3, title: "x" }),
    );
  });
});

describe("remembering a sort order", () => {
  const feed: Selection = { kind: "feed", id: 12, title: "The Go Blog" };
  const other: Selection = { kind: "feed", id: 13, title: "Lobsters" };

  it("defaults to newest when nothing is stored", () => {
    stubStorage();
    expect(readSort(feed)).toBe("newest");
  });

  it("round-trips a choice, per feed", () => {
    stubStorage();
    writeSort(feed, "oldest");
    expect(readSort(feed)).toBe("oldest");
    // A different feed keeps its own default.
    expect(readSort(other)).toBe("newest");
  });

  it("ignores a stored value that is not a sort order", () => {
    const store = stubStorage();
    store.set(sortKey(feed), "sideways");
    expect(readSort(feed)).toBe("newest");
  });

  it("falls back instead of throwing when storage is unavailable", () => {
    // Private windows and blocked site data make localStorage throw outright;
    // that must not take the reader down.
    stubStorage(true);
    expect(readSort(feed)).toBe("newest");
    expect(() => writeSort(feed, "magic")).not.toThrow();
  });

  it("survives there being no window at all", () => {
    vi.stubGlobal("window", undefined);
    expect(readSort(feed)).toBe("newest");
    expect(() => writeSort(feed, "magic")).not.toThrow();
  });
});

describe("shuffle", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it("keeps every item exactly once", () => {
    const shuffled = shuffle(items, 12345);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it("is stable for a seed, so React re-renders do not reorder the list", () => {
    expect(shuffle(items, 999)).toEqual(shuffle(items, 999));
  });

  it("actually reorders", () => {
    expect(shuffle(items, 7)).not.toEqual(items);
  });

  it("gives different seeds different orders", () => {
    expect(shuffle(items, 1)).not.toEqual(shuffle(items, 2));
  });

  it("leaves the input untouched", () => {
    const original = [...items];
    shuffle(items, 42);
    expect(items).toEqual(original);
  });

  it("handles empty and single-item lists", () => {
    expect(shuffle([], 1)).toEqual([]);
    expect(shuffle(["only"], 1)).toEqual(["only"]);
  });
});
