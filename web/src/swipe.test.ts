import { describe, expect, it } from "vitest";

import {
  ACTION_DISTANCE,
  DOMINANCE,
  EDGE_ZONE,
  SLOP,
  rowSwipeVerdict,
  swipeCommitted,
  type RowSwipeAttempt,
} from "./swipe";

/** A clean rightward swipe across a phone-width screen, clear of every guard. */
function attempt(overrides: Partial<RowSwipeAttempt> = {}): RowSwipeAttempt {
  return {
    dx: ACTION_DISTANCE + 20,
    dy: 0,
    startX: 200,
    width: 390,
    pointers: 1,
    ...overrides,
  };
}

describe("rowSwipeVerdict", () => {
  it("stars on a swipe to the right", () => {
    expect(rowSwipeVerdict(attempt())).toBe("star");
  });

  it("marks read on a swipe to the left", () => {
    expect(rowSwipeVerdict(attempt({ dx: -(ACTION_DISTANCE + 20) }))).toBe("read");
  });

  it("does nothing for a drag that was let go short", () => {
    expect(rowSwipeVerdict(attempt({ dx: ACTION_DISTANCE - 1 }))).toBe("none");
  });

  it("leaves both screen edges to the system's back gesture", () => {
    expect(rowSwipeVerdict(attempt({ startX: EDGE_ZONE }))).toBe("none");
    expect(rowSwipeVerdict(attempt({ startX: 390 - EDGE_ZONE }))).toBe("none");
  });

  it("ignores pinches", () => {
    expect(rowSwipeVerdict(attempt({ pointers: 2 }))).toBe("none");
  });

  it("treats a mostly vertical drag as a scroll", () => {
    const dx = ACTION_DISTANCE + 20;
    expect(rowSwipeVerdict(attempt({ dx, dy: dx / DOMINANCE }))).toBe("none");
    expect(rowSwipeVerdict(attempt({ dx, dy: dx / DOMINANCE - 1 }))).toBe("star");
  });
});

describe("swipeCommitted", () => {
  it("lets a tap's wobble stay a tap", () => {
    expect(swipeCommitted(attempt({ dx: SLOP - 1 }))).toBe(false);
  });

  it("starts following once the drag is clearly sideways", () => {
    expect(swipeCommitted(attempt({ dx: SLOP + 1 }))).toBe(true);
  });
});
