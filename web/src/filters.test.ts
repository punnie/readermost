import { afterEach, describe, expect, it, vi } from "vitest";

import {
  matchesLength,
  readLengthFilter,
  readStatusFilter,
  statusesFor,
  writeLengthFilter,
  writeStatusFilter,
} from "./filters";
import type { Entry, Selection } from "./types";

function entry(readingTime: number): Entry {
  return { reading_time: readingTime } as Entry;
}

function stubStorage(throwing = false) {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => {
        if (throwing) throw new Error("denied");
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (throwing) throw new Error("denied");
        store.set(key, value);
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("statusesFor", () => {
  it("asks Miniflux for exactly the statuses wanted", () => {
    expect(statusesFor("unread")).toEqual(["unread"]);
    expect(statusesFor("read")).toEqual(["read"]);
    expect(statusesFor("all")).toEqual(["unread", "read"]);
  });
});

describe("matchesLength", () => {
  it("passes everything when no length is chosen", () => {
    for (const minutes of [0, 1, 5, 20, 72]) {
      expect(matchesLength(entry(minutes), "any")).toBe(true);
    }
  });

  it("splits at the boundaries the real feeds justify", () => {
    // Tiers are under 3 / 3-9 / 10+, chosen from the actual spread: news and
    // aggregators are almost all one-minute, engineering blogs fill 3-9.
    expect(matchesLength(entry(2), "quick")).toBe(true);
    expect(matchesLength(entry(3), "quick")).toBe(false);

    expect(matchesLength(entry(3), "medium")).toBe(true);
    expect(matchesLength(entry(9), "medium")).toBe(true);
    expect(matchesLength(entry(10), "medium")).toBe(false);

    expect(matchesLength(entry(10), "long")).toBe(true);
    expect(matchesLength(entry(72), "long")).toBe(true);
    expect(matchesLength(entry(9), "long")).toBe(false);
  });

  it("treats an unmeasurable article as quick", () => {
    // A comic has no prose, so Miniflux reports zero. It is a quick read.
    expect(matchesLength(entry(0), "quick")).toBe(true);
    expect(matchesLength(entry(0), "long")).toBe(false);
  });

  it("does not choke on a missing reading time", () => {
    const missing = {} as Entry;
    expect(matchesLength(missing, "quick")).toBe(true);
    expect(matchesLength(missing, "any")).toBe(true);
  });

  it("puts every article in exactly one tier", () => {
    for (const minutes of [0, 1, 2, 3, 9, 10, 40]) {
      const tiers = (["quick", "medium", "long"] as const).filter((tier) =>
        matchesLength(entry(minutes), tier),
      );
      expect(tiers).toHaveLength(1);
    }
  });
});

describe("remembering filters", () => {
  const feed: Selection = { kind: "feed", id: 12, title: "The Go Blog" };
  const folder: Selection = { kind: "category", id: 12, title: "Tech" };

  it("defaults to showing everything, any length", () => {
    stubStorage();
    expect(readStatusFilter(feed)).toBe("all");
    expect(readLengthFilter(feed)).toBe("any");
  });

  it("keeps each selection's filters apart", () => {
    stubStorage();
    writeStatusFilter(feed, "unread");
    writeLengthFilter(feed, "long");

    expect(readStatusFilter(feed)).toBe("unread");
    expect(readLengthFilter(feed)).toBe("long");

    // A folder with the same id must not inherit the feed's filters.
    expect(readStatusFilter(folder)).toBe("all");
    expect(readLengthFilter(folder)).toBe("any");
  });

  it("keeps status and length apart for one selection", () => {
    stubStorage();
    writeStatusFilter(feed, "read");
    expect(readLengthFilter(feed)).toBe("any");
  });

  it("falls back when storage is unavailable", () => {
    stubStorage(true);
    expect(readStatusFilter(feed)).toBe("all");
    expect(readLengthFilter(feed)).toBe("any");
    expect(() => writeStatusFilter(feed, "unread")).not.toThrow();
  });
});
