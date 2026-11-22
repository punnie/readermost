import { describe, expect, it } from "vitest";

import {
  HIDE_AFTER,
  PULL_THRESHOLD,
  SHOW_AFTER,
  nextBarState,
  pullArmed,
  pullFor,
  scrollProgress,
  type BarState,
} from "./scrolling";

const shown: BarState = { hidden: false, travel: 0 };

/** Feeds a series of scroll deltas through, mid-article. */
function scrollBy(deltas: number[], start = shown): BarState {
  return deltas.reduce((state, delta) => nextBarState(state, delta, false, false), start);
}

describe("nextBarState", () => {
  it("stays put for a small downward scroll", () => {
    expect(scrollBy([HIDE_AFTER - 1]).hidden).toBe(false);
  });

  it("tucks away once the reader is clearly scrolling down", () => {
    expect(scrollBy([10, 10, HIDE_AFTER - 20]).hidden).toBe(true);
  });

  it("comes back on a small upward nudge", () => {
    const hidden = scrollBy([200]);
    expect(scrollBy([-(SHOW_AFTER - 1)], hidden).hidden).toBe(true);
    expect(scrollBy([-SHOW_AFTER], hidden).hidden).toBe(false);
  });

  it("starts counting afresh when the direction changes", () => {
    const hidden = scrollBy([200]);
    // Up a little, then down a little: neither leg is enough on its own.
    const state = scrollBy([-4, 4], hidden);
    expect(state.hidden).toBe(true);
  });

  it("always shows at the top and at the bottom", () => {
    const hidden = scrollBy([200]);
    expect(nextBarState(hidden, 50, true, false).hidden).toBe(false);
    expect(nextBarState(hidden, 50, false, true).hidden).toBe(false);
  });
});

describe("scrollProgress", () => {
  it("runs from 0 at the top to 1 at the bottom", () => {
    expect(scrollProgress(0, 2000, 800)).toBe(0);
    expect(scrollProgress(600, 2000, 800)).toBe(0.5);
    expect(scrollProgress(1200, 2000, 800)).toBe(1);
  });

  it("counts a pane that does not scroll as read", () => {
    expect(scrollProgress(0, 500, 800)).toBe(1);
  });
});

describe("pulling past the end", () => {
  it("arms exactly at the threshold", () => {
    expect(pullArmed(PULL_THRESHOLD - 1)).toBe(false);
    expect(pullArmed(PULL_THRESHOLD)).toBe(true);
  });

  it("resists, and stops moving well past the threshold", () => {
    expect(pullFor(0)).toBe(0);
    expect(pullFor(-20)).toBe(0);
    expect(pullFor(40)).toBeLessThan(40);
    expect(pullFor(10_000)).toBe(pullFor(PULL_THRESHOLD * 3));
  });
});
