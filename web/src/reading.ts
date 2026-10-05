/**
 * How the app looks: the typeface, size and spacing of articles and
 * discussions, the accent colour the chrome is drawn in, and whether unread
 * items are counted.
 *
 * The server keeps the choice so it follows the reader between devices; this
 * module turns it into attributes on <html>, and styles.css does the rest. A
 * copy is also kept in localStorage purely so a reload paints in the right
 * typeface and colour straight away rather than flashing the default first.
 */

export const FONT_FAMILIES = ["sans", "serif", "mono", "opendyslexic"] as const;
export const TEXT_SIZES = ["small", "medium", "large", "xlarge"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
/** Named rather than free-form, so each has a tuned light and dark variant. */
export const ACCENTS = ["blue", "teal", "green", "orange", "rose", "purple", "graphite"] as const;
/** Whether unread items show how many, or only that there are some. */
export const UNREAD_MARKS = ["count", "dot"] as const;

export type FontFamily = (typeof FONT_FAMILIES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Density = (typeof DENSITIES)[number];
export type Accent = (typeof ACCENTS)[number];
export type UnreadMark = (typeof UNREAD_MARKS)[number];

export interface ReadingPrefs {
  font_family: FontFamily;
  text_size: TextSize;
  density: Density;
  accent: Accent;
  unread_mark: UnreadMark;
}

/** Matches the server's defaults, and the look the reader had before. */
export const DEFAULT_READING_PREFS: ReadingPrefs = {
  font_family: "sans",
  text_size: "medium",
  density: "comfortable",
  accent: "blue",
  unread_mark: "count",
};

export const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  sans: "Sans-serif",
  serif: "Serif",
  mono: "Monospace",
  opendyslexic: "OpenDyslexic",
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  xlarge: "Extra large",
};

export const DENSITY_LABELS: Record<Density, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious",
};

export const ACCENT_LABELS: Record<Accent, string> = {
  blue: "Blue",
  teal: "Teal",
  green: "Green",
  orange: "Orange",
  rose: "Rose",
  purple: "Purple",
  graphite: "Graphite",
};

export const UNREAD_MARK_LABELS: Record<UnreadMark, string> = {
  count: "Counts",
  dot: "Dots",
};

function oneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/**
 * Reads prefs from anywhere untrusted — a stored copy, an old server — keeping
 * each valid field and defaulting the rest, so one stale value does not throw
 * away the others.
 */
export function parseReadingPrefs(value: unknown): ReadingPrefs {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    font_family: oneOf(FONT_FAMILIES, raw.font_family)
      ? raw.font_family
      : DEFAULT_READING_PREFS.font_family,
    text_size: oneOf(TEXT_SIZES, raw.text_size) ? raw.text_size : DEFAULT_READING_PREFS.text_size,
    density: oneOf(DENSITIES, raw.density) ? raw.density : DEFAULT_READING_PREFS.density,
    accent: oneOf(ACCENTS, raw.accent) ? raw.accent : DEFAULT_READING_PREFS.accent,
    unread_mark: oneOf(UNREAD_MARKS, raw.unread_mark)
      ? raw.unread_mark
      : DEFAULT_READING_PREFS.unread_mark,
  };
}

const STORAGE_KEY = "readermost:reading-prefs";

/** The last prefs this device applied, for painting before the server answers. */
export function readCachedReadingPrefs(): ReadingPrefs {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return parseReadingPrefs(stored ? JSON.parse(stored) : undefined);
  } catch {
    return DEFAULT_READING_PREFS;
  }
}

/** Puts prefs into effect on the page and remembers them for the next load. */
export function applyReadingPrefs(prefs: ReadingPrefs): void {
  const root = document.documentElement;
  root.dataset.font = prefs.font_family;
  root.dataset.textSize = prefs.text_size;
  root.dataset.density = prefs.density;
  root.dataset.accent = prefs.accent;

  // The browser's own chrome — the PWA title bar, a phone's status bar —
  // follows the accent too. Read back from CSS so light and dark both match.
  const accent = getComputedStyle(root).getPropertyValue("--accent").trim();
  if (accent) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", accent);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Only the head start on the next load is lost; the server has the truth.
  }
}

/** Back to the defaults on this device, for sign-out. */
export function forgetReadingPrefs(): void {
  applyReadingPrefs(DEFAULT_READING_PREFS);
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to undo.
  }
}
