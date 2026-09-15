import { describe, expect, it } from "vitest";

import { DOMINANCE, EDGE_ZONE, MIN_DISTANCE, swipeVerdict, type SwipeAttempt } from "./swipe";

/** A clean rightward swipe, well clear of every guard. */
function attempt(overrides: Partial<SwipeAttempt> = {}): SwipeAttempt {
  return {
    dx: MIN_DISTANCE + 20,
    dy: 0,
    startX: 200,
    pointers: 1,
    inScrollable: false,
    ...overrides,
  };
}

describe("swipeVerdict", () => {
  it("reads direction the way a page turns", () => {
    expect(swipeVerdict(attempt({ dx: 120 }))).toBe("previous");
    expect(swipeVerdict(attempt({ dx: -120 }))).toBe("next");
  });

  it("ignores a drag too short to be deliberate", () => {
    expect(swipeVerdict(attempt({ dx: MIN_DISTANCE - 1 }))).toBe("none");
    expect(swipeVerdict(attempt({ dx: 0 }))).toBe("none");
  });

  it("leaves vertical scrolling alone", () => {
    // Dragging down and a little sideways is a scroll, not a swipe.
    expect(swipeVerdict(attempt({ dx: 80, dy: 300 }))).toBe("none");
    // Exactly at the dominance threshold is still a scroll.
    expect(swipeVerdict(attempt({ dx: 100, dy: 100 / DOMINANCE }))).toBe("none");
    // Clearly horizontal gets through.
    expect(swipeVerdict(attempt({ dx: 200, dy: 20 }))).toBe("previous");
  });

  it("leaves the drawer's edge zone alone", () => {
    // This strip is how the drawer is opened; the article must not also move.
    expect(swipeVerdict(attempt({ startX: 0 }))).toBe("none");
    expect(swipeVerdict(attempt({ startX: EDGE_ZONE }))).toBe("none");
    expect(swipeVerdict(attempt({ startX: EDGE_ZONE + 1 }))).toBe("previous");
  });

  it("does not turn a pinch into a swipe", () => {
    expect(swipeVerdict(attempt({ pointers: 2 }))).toBe("none");
  });

  it("lets a code block scroll sideways", () => {
    // The whole reason for walking up the DOM: swiping a wide <pre> must
    // scroll the <pre>, not skip the article.
    expect(swipeVerdict(attempt({ inScrollable: true }))).toBe("none");
    expect(swipeVerdict(attempt({ inScrollable: true, dx: -400 }))).toBe("none");
  });

  it("requires every guard to pass, not just one", () => {
    // A long horizontal drag that still starts in the edge zone stays ignored.
    expect(swipeVerdict(attempt({ dx: 400, startX: 5 }))).toBe("none");
  });
});
