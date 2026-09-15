import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withTimeout } from "./persist";

/**
 * These cover the bug that made the app unusable rather than merely uncached:
 * the reader waits for the restored cache before it renders anything, so an
 * IndexedDB that never answers meant a permanent "Loading…".
 */
describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("passes a value straight through when storage answers", async () => {
    const result = withTimeout(Promise.resolve("cached"), null, "reading");
    await expect(result).resolves.toBe("cached");
  });

  it("falls back when storage never answers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // A promise that never settles is exactly what a blocked IndexedDB does.
    const result = withTimeout(new Promise<string>(() => {}), null, "reading");
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toBeNull();
  });

  it("falls back when storage rejects", async () => {
    const result = withTimeout(Promise.reject(new Error("denied")), null, "reading");
    await expect(result).resolves.toBeNull();
  });

  it("does not reject, whatever storage does", async () => {
    // The caller is the render path; it has no way to handle a rejection.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hung = withTimeout(new Promise<void>(() => {}), undefined, "writing");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(hung).resolves.toBeUndefined();
  });

  it("says so once, not on every access", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await Promise.all([
      (async () => {
        const p = withTimeout(new Promise<string>(() => {}), null, "reading");
        await vi.advanceTimersByTimeAsync(3000);
        return p;
      })(),
    ]);
    const first = warn.mock.calls.length;

    const second = withTimeout(new Promise<string>(() => {}), null, "reading");
    await vi.advanceTimersByTimeAsync(3000);
    await second;

    expect(warn.mock.calls.length).toBe(first);
  });
});
