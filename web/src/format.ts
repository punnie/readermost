/**
 * Date and time formatting, in one place.
 *
 * Everything follows the viewer's own locale, so a pt-PT browser gets
 * 15/09/2026 and an en-US one gets 9/15/2026, with no setting to find.
 */

/** undefined means "the browser's locale" for every Intl constructor. */
const LOCALE: string | undefined = undefined;

/**
 * Times are shown 24-hour even where the locale would prefer AM/PM.
 *
 * This is the one place the locale is overridden, because a dense reader is
 * easier to scan with fixed-width times. Set it to undefined to follow the
 * locale here too.
 */
const HOUR12: boolean | undefined = false;

const time = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: HOUR12,
});

const date = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: HOUR12,
});

/** Day and month only, for entries from this year. */
const dayMonth = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
});

/** Month and year, for anything older. */
const monthYear = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  year: "numeric",
});

function parse(value: string | number | Date): Date | undefined {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** "14:32" */
export function formatTime(value: string | number | Date): string {
  const parsed = parse(value);
  return parsed ? time.format(parsed) : "";
}

/** "15/09/2026" */
export function formatDate(value: string | number | Date): string {
  const parsed = parse(value);
  return parsed ? date.format(parsed) : "";
}

/** "15/09/2026, 14:32" */
export function formatDateTime(value: string | number | Date): string {
  const parsed = parse(value);
  return parsed ? dateTime.format(parsed) : "";
}

/**
 * The entry list's compact stamp: a time for today, a day and month for this
 * year, a month and year for anything older. Column width stays roughly
 * constant, which is what makes a long list scannable.
 */
export function formatListDate(value: string | number | Date): string {
  const parsed = parse(value);
  if (!parsed) return "";

  const ageHours = (Date.now() - parsed.getTime()) / 36e5;
  if (ageHours < 24) return time.format(parsed);
  if (ageHours < 24 * 365) return dayMonth.format(parsed);
  return monthYear.format(parsed);
}

/** "just now", "5m ago", "3h ago", "2d ago", then an absolute date. */
export function timeAgo(value: string | number | Date): string {
  const parsed = parse(value);
  if (!parsed) return "";

  const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.format(parsed);
}
