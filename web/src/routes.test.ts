import { describe, expect, it } from "vitest";

import { DEFAULT_ROUTE, pathFor, routeFromPath, sameSelection } from "./routes";
import type { Selection } from "./types";

const SELECTIONS: Selection[] = [
  { kind: "unread" },
  { kind: "all" },
  { kind: "starred" },
  { kind: "shared" },
  { kind: "feed", id: 12 },
  { kind: "category", id: 5 },
];

describe("round-tripping", () => {
  it("every selection survives a trip through a URL", () => {
    for (const selection of SELECTIONS) {
      expect(routeFromPath(pathFor(selection)).selection).toEqual(selection);
    }
  });

  it("keeps the open article", () => {
    for (const selection of SELECTIONS) {
      if (selection.kind === "shared") continue;
      const route = routeFromPath(pathFor(selection, 345));
      expect(route.selection).toEqual(selection);
      expect(route.entryID).toBe(345);
    }
  });

  it("keeps the open shared post", () => {
    // Mattermost ids are 26 characters, not numbers.
    const route = routeFromPath(pathFor({ kind: "shared" }, "c5y3au8ap78auxsojr5n54g4mh"));
    expect(route.selection).toEqual({ kind: "shared" });
    expect(route.postID).toBe("c5y3au8ap78auxsojr5n54g4mh");
  });

  it("does not confuse a feed with a folder of the same id", () => {
    expect(pathFor({ kind: "feed", id: 3 })).not.toBe(pathFor({ kind: "category", id: 3 }));
  });
});

describe("reading a path", () => {
  it("treats the root as unread", () => {
    expect(routeFromPath("/").selection).toEqual({ kind: "unread" });
    expect(routeFromPath("").selection).toEqual({ kind: "unread" });
  });

  it("tolerates a trailing slash", () => {
    expect(routeFromPath("/feed/12/")).toEqual({
      selection: { kind: "feed", id: 12 },
      entryID: undefined,
    });
  });

  it("falls back rather than erroring on nonsense", () => {
    for (const path of ["/nope", "/feed", "/feed/abc", "/feed/0", "/feed/-1", "/folder/x"]) {
      expect(routeFromPath(path).selection).toEqual({ kind: "unread" });
    }
  });

  it("ignores a malformed article id but keeps the feed", () => {
    // A bad article id should not throw away which feed you were reading.
    const route = routeFromPath("/feed/12/abc");
    expect(route.selection).toEqual({ kind: "feed", id: 12 });
    expect(route.entryID).toBeUndefined();
  });

  it("points the default route somewhere it can actually read", () => {
    expect(routeFromPath(DEFAULT_ROUTE).selection).toEqual({ kind: "unread" });
  });
});

describe("sameSelection", () => {
  it("matches identical selections", () => {
    expect(sameSelection({ kind: "unread" }, { kind: "unread" })).toBe(true);
    expect(sameSelection({ kind: "feed", id: 1 }, { kind: "feed", id: 1 })).toBe(true);
  });

  it("separates different kinds and ids", () => {
    expect(sameSelection({ kind: "feed", id: 1 }, { kind: "category", id: 1 })).toBe(false);
    expect(sameSelection({ kind: "feed", id: 1 }, { kind: "feed", id: 2 })).toBe(false);
    expect(sameSelection({ kind: "unread" }, { kind: "all" })).toBe(false);
  });
});
