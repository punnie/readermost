import { prefKey, readPref, writePref } from "./prefs";
import type { Entry, Selection } from "./types";

/** Which articles to show, by read state. Applied by Miniflux. */
export type StatusFilter = "all" | "unread" | "read";

/**
 * How long an article takes to read, in tiers rather than minutes.
 *
 * The boundaries come from the shape of real feeds rather than round numbers:
 * aggregators and news are almost entirely one-minute items, engineering blogs
 * spread across three to nine, and only long-form pieces pass ten. Splitting at
 * five and fifteen — the obvious guess — would have put nearly everything in a
 * single bucket.
 */
export type LengthFilter = "any" | "quick" | "medium" | "long";

export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Everything",
  unread: "Unread only",
  read: "Read only",
};

export const LENGTH_LABELS: Record<LengthFilter, string> = {
  any: "Any length",
  quick: "Quick · under 3 min",
  medium: "Medium · 3–9 min",
  long: "Long · 10 min+",
};

/** The statuses to request from Miniflux for a given filter. */
export function statusesFor(filter: StatusFilter): ("read" | "unread")[] {
  switch (filter) {
    case "unread":
      return ["unread"];
    case "read":
      return ["read"];
    case "all":
    default:
      return ["unread", "read"];
  }
}

/**
 * Does an entry fall in this tier?
 *
 * A reading time of zero means Miniflux found no prose to measure — a comic, or
 * a link-only post. Those count as quick: they are, in fact, quick.
 */
export function matchesLength(entry: Entry, filter: LengthFilter): boolean {
  const minutes = entry.reading_time ?? 0;
  switch (filter) {
    case "quick":
      return minutes < 3;
    case "medium":
      return minutes >= 3 && minutes < 10;
    case "long":
      return minutes >= 10;
    case "any":
    default:
      return true;
  }
}

function isStatusFilter(value: unknown): value is StatusFilter {
  return value === "all" || value === "unread" || value === "read";
}

function isLengthFilter(value: unknown): value is LengthFilter {
  return value === "any" || value === "quick" || value === "medium" || value === "long";
}

export function readStatusFilter(selection: Selection): StatusFilter {
  return readPref(prefKey("status", selection), isStatusFilter, "all");
}

export function writeStatusFilter(selection: Selection, filter: StatusFilter): void {
  writePref(prefKey("status", selection), filter);
}

export function readLengthFilter(selection: Selection): LengthFilter {
  return readPref(prefKey("length", selection), isLengthFilter, "any");
}

export function writeLengthFilter(selection: Selection, filter: LengthFilter): void {
  writePref(prefKey("length", selection), filter);
}
