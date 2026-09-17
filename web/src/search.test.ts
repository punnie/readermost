import { describe, expect, it } from "vitest";

import { fold, matchFeeds, mayNeedAccents } from "./search";
import type { Tree } from "./types";

function tree(names: [string, string][]): Tree {
  const byFolder = new Map<string, string[]>();
  for (const [folder, title] of names) {
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), title]);
  }
  return {
    total_unread: 0,
    categories: [...byFolder].map(([title, feeds], index) => ({
      id: index + 1,
      title,
      unread: 0,
      feeds: feeds.map((feedTitle, feedIndex) => ({
        id: (index + 1) * 100 + feedIndex,
        title: feedTitle,
        site_url: "",
        feed_url: "",
        unread: 0,
        has_icon: false,
        disabled: false,
      })),
    })),
  };
}

describe("fold", () => {
  it("lowercases", () => {
    expect(fold("The Go Blog")).toBe("the go blog");
  });

  it("strips accents, which is the whole point", () => {
    // Miniflux cannot match these; here both sides are folded the same way.
    expect(fold("Política")).toBe("politica");
    expect(fold("Expressão")).toBe("expressao");
    expect(fold("Público")).toBe("publico");
    expect(fold("Économie")).toBe("economie");
  });

  it("folds both sides to the same thing", () => {
    expect(fold("politica")).toBe(fold("Política"));
    expect(fold("SAO PAULO")).toBe(fold("São Paulo"));
  });

  it("trims", () => {
    expect(fold("  hello  ")).toBe("hello");
  });
});

describe("matchFeeds", () => {
  const feeds = tree([
    ["News", "Público"],
    ["News", "Observador"],
    ["Tech", "The Go Blog"],
    ["Tech", "Go Time Podcast"],
    ["Comics", "Oglaf"],
  ]);

  it("finds an accented name from an unaccented query", () => {
    const found = matchFeeds(feeds, "publico");
    expect(found.map((m) => m.feed.title)).toEqual(["Público"]);
  });

  it("returns nothing for an empty query", () => {
    expect(matchFeeds(feeds, "")).toEqual([]);
    expect(matchFeeds(feeds, "   ")).toEqual([]);
  });

  it("returns nothing when the tree has not loaded", () => {
    expect(matchFeeds(undefined, "go")).toEqual([]);
  });

  it("ranks a prefix above a match buried mid-word", () => {
    // "Go Time Podcast" starts with Go; "The Go Blog" has it at a word start;
    // "Oglaf" contains no match at all.
    const found = matchFeeds(feeds, "go").map((m) => m.feed.title);
    expect(found[0]).toBe("Go Time Podcast");
    expect(found).toContain("The Go Blog");
    expect(found).not.toContain("Oglaf");
  });

  it("ranks an exact name first", () => {
    const found = matchFeeds(feeds, "oglaf");
    expect(found[0].feed.title).toBe("Oglaf");
  });

  it("reports which folder a feed lives in", () => {
    expect(matchFeeds(feeds, "observador")[0].folder).toBe("News");
  });

  it("does not choke on regex characters in the query", () => {
    expect(() => matchFeeds(feeds, "c++ (a|b) [x]")).not.toThrow();
  });
});

describe("mayNeedAccents", () => {
  it("flags an unaccented query that could have meant an accented word", () => {
    expect(mayNeedAccents("politica")).toBe(true);
    expect(mayNeedAccents("economia")).toBe(true);
  });

  it("stays quiet when the reader already typed accents", () => {
    expect(mayNeedAccents("política")).toBe(false);
  });

  it("stays quiet for queries with no accentable letters", () => {
    expect(mayNeedAccents("xyz")).toBe(false);
  });
});
