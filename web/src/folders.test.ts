import { describe, expect, it } from "vitest";

import { defaultMoveTarget, otherFolders, parseCollapsed, serializeCollapsed } from "./folders";
import type { Tree } from "./types";

describe("parseCollapsed", () => {
  it("reads back what serializeCollapsed wrote", () => {
    const collapsed = new Set([12, 3, 7]);
    expect(parseCollapsed(serializeCollapsed(collapsed))).toEqual(collapsed);
  });

  it("stores ids in a stable order", () => {
    expect(serializeCollapsed(new Set([12, 3, 7]))).toBe("[3,7,12]");
  });

  it("treats nothing stored as nothing collapsed", () => {
    expect(parseCollapsed(null)).toEqual(new Set());
    expect(parseCollapsed("")).toEqual(new Set());
  });

  it("ignores garbage rather than throwing", () => {
    expect(parseCollapsed("{not json")).toEqual(new Set());
    expect(parseCollapsed('{"a":1}')).toEqual(new Set());
    expect(parseCollapsed('[1,"2",-3,4.5,null,6]')).toEqual(new Set([1, 6]));
  });
});

const tree: Tree = {
  total_unread: 0,
  categories: [
    { id: 5, title: "News", unread: 0, feeds: [] },
    { id: 2, title: "Blogs", unread: 0, feeds: [] },
    { id: 9, title: "Comics", unread: 0, feeds: [] },
  ],
};

describe("defaultMoveTarget", () => {
  it("picks the oldest remaining folder, like the server", () => {
    expect(defaultMoveTarget(tree, 5)?.id).toBe(2);
    expect(defaultMoveTarget(tree, 2)?.id).toBe(5);
  });

  it("has nowhere to go when the folder is the only one", () => {
    const lonely: Tree = { total_unread: 0, categories: [tree.categories[0]] };
    expect(defaultMoveTarget(lonely, 5)).toBeUndefined();
    expect(defaultMoveTarget(undefined, 5)).toBeUndefined();
  });
});

describe("otherFolders", () => {
  it("leaves out the excluded folder, oldest first", () => {
    expect(otherFolders(tree, 5).map((category) => category.id)).toEqual([2, 9]);
  });
});
