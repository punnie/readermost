import { describe, expect, it } from "vitest";

import { SCROLL_MAX_SPEED, SCROLL_ZONE, autoScrollSpeed } from "./dnd";

describe("autoScrollSpeed", () => {
  const top = 100;
  const bottom = 700;

  it("stays still in the middle of the list", () => {
    expect(autoScrollSpeed(400, top, bottom)).toBe(0);
    expect(autoScrollSpeed(top + SCROLL_ZONE, top, bottom)).toBe(0);
    expect(autoScrollSpeed(bottom - SCROLL_ZONE, top, bottom)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(autoScrollSpeed(top + 10, top, bottom)).toBeLessThan(0);
    expect(autoScrollSpeed(bottom - 10, top, bottom)).toBeGreaterThan(0);
  });

  it("goes faster the closer the pointer is to the edge", () => {
    const near = autoScrollSpeed(bottom - 5, top, bottom);
    const far = autoScrollSpeed(bottom - 60, top, bottom);
    expect(near).toBeGreaterThan(far);
    expect(autoScrollSpeed(bottom, top, bottom)).toBe(SCROLL_MAX_SPEED);
    expect(autoScrollSpeed(top, top, bottom)).toBe(-SCROLL_MAX_SPEED);
  });

  it("ignores a pointer outside the list", () => {
    expect(autoScrollSpeed(top - 1, top, bottom)).toBe(0);
    expect(autoScrollSpeed(bottom + 1, top, bottom)).toBe(0);
  });

  it("splits a short list between the two zones rather than overlapping them", () => {
    // 100px tall: each zone is 50px, so just above the middle scrolls up.
    expect(autoScrollSpeed(149, 100, 200)).toBeLessThan(0);
    expect(autoScrollSpeed(151, 100, 200)).toBeGreaterThan(0);
  });

  it("does nothing for a list with no height", () => {
    expect(autoScrollSpeed(100, 100, 100)).toBe(0);
  });
});
