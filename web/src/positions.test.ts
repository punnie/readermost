import { describe, expect, it } from "vitest";

import { parsePositions, recall, remember, type Positions } from "./positions";

describe("remember", () => {
  it("puts the latest article first", () => {
    const positions = remember(remember([], "entry:1", 100), "entry:2", 200);
    expect(positions.map(([key]) => key)).toEqual(["entry:2", "entry:1"]);
  });

  it("moves an article already on the list to the front, with its new offset", () => {
    let positions: Positions = [];
    positions = remember(positions, "entry:1", 100);
    positions = remember(positions, "entry:2", 200);
    positions = remember(positions, "entry:1", 150);
    expect(positions).toEqual([
      ["entry:1", 150],
      ["entry:2", 200],
    ]);
  });

  it("drops the least recently read once full", () => {
    let positions: Positions = [];
    for (let id = 1; id <= 4; id++) positions = remember(positions, `entry:${id}`, id, 3);
    expect(positions.map(([key]) => key)).toEqual(["entry:4", "entry:3", "entry:2"]);
    expect(recall(positions, "entry:1")).toBe(0);
  });
});

describe("recall", () => {
  it("returns the saved offset", () => {
    expect(recall([["shared:abc", 420]], "shared:abc")).toBe(420);
  });

  it("starts anything unknown at the top", () => {
    expect(recall([["entry:1", 420]], "entry:2")).toBe(0);
  });
});

describe("parsePositions", () => {
  it("reads back what was stored", () => {
    const positions: Positions = [
      ["entry:1", 10],
      ["shared:x", 20],
    ];
    expect(parsePositions(JSON.stringify(positions))).toEqual(positions);
  });

  it("forgets anything malformed", () => {
    expect(parsePositions(null)).toEqual([]);
    expect(parsePositions("not json")).toEqual([]);
    expect(parsePositions('{"entry:1":10}')).toEqual([]);
    expect(parsePositions('[["entry:1",10],["entry:2","x"],[3,4],["entry:5",-1]]')).toEqual([
      ["entry:1", 10],
    ]);
  });
});
