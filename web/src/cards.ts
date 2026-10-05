import type { Entry } from "./types";

/**
 * The card deck: triaging a list one article at a time, the way a dating app
 * triages people. Left is "seen it, move on", right is "keep this".
 *
 * The rules live here, away from the pointer plumbing in CardDeck, because
 * each one is a judgement call worth pinning down in a test.
 */

export type CardVerdict = "none" | "read" | "star";

/** A card must travel this share of its own width to be thrown. */
export const THROW_FRACTION = 0.3;

/**
 * Or be flung at least this fast, in px/ms. A quick flick should count even
 * when it is short — that is most of what makes the deck feel fast.
 */
export const FLING_VELOCITY = 0.5;

/** A flick still has to go somewhere: this far, at least. */
export const FLING_MIN_DISTANCE = 40;

/** Below this much movement a release is a tap, which opens the article. */
export const TAP_SLOP = 8;

/** Degrees of tilt per pixel of travel: the card pivots as if held at the bottom. */
export const TILT_PER_PX = 0.06;

export interface CardRelease {
  /** Horizontal travel; positive is rightwards. */
  dx: number;
  /** Horizontal speed at release, px/ms; positive is rightwards. */
  vx: number;
  /** The card's width, so the threshold scales with the screen. */
  width: number;
}

/** Was the card thrown, and which way? */
export function cardVerdict({ dx, vx, width }: CardRelease): CardVerdict {
  const far = Math.abs(dx) >= width * THROW_FRACTION;
  // A fling only counts in the direction the card is already going: a drag
  // right that snaps back left at the end is someone changing their mind.
  const flung =
    Math.abs(dx) >= FLING_MIN_DISTANCE &&
    Math.abs(vx) >= FLING_VELOCITY &&
    Math.sign(vx) === Math.sign(dx);

  if (!far && !flung) return "none";
  return dx > 0 ? "star" : "read";
}

/** How far through a throw the card is, -1 (read) to 1 (star), for the stamps. */
export function throwProgress(dx: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(-1, Math.min(1, dx / (width * THROW_FRACTION)));
}

/**
 * What the deck still holds.
 *
 * Built from the order the deck was dealt in rather than from the live list,
 * because the live list reorders and drops entries as they are marked read —
 * the card under your thumb must not change underneath it. The live list still
 * decides status, so an article read elsewhere does not come round again.
 */
export function remainingCards(
  dealt: Entry[],
  live: Entry[],
  decided: ReadonlySet<number>,
): Entry[] {
  const byId = new Map(live.map((entry) => [entry.id, entry]));

  return dealt.flatMap((entry) => {
    if (decided.has(entry.id)) return [];
    const current = byId.get(entry.id) ?? entry;
    return current.status === "unread" ? [current] : [];
  });
}

/**
 * Add anything new in the live list to the end of the deck.
 *
 * The deck can be opened before the list has loaded, and a refresh can bring
 * new articles in mid-session; both join at the back rather than jumping the
 * queue.
 */
export function dealNew(dealt: Entry[], live: Entry[]): Entry[] {
  const known = new Set(dealt.map((entry) => entry.id));
  const fresh = live.filter((entry) => entry.status === "unread" && !known.has(entry.id));
  return fresh.length === 0 ? dealt : [...dealt, ...fresh];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/**
 * A plain-text teaser from an article's HTML.
 *
 * Only ever shown as text, never as markup, so a rough strip is safe: the
 * worst a missed tag can do is look untidy.
 */
export function excerpt(html: string, max = 280): string {
  const text = html
    // Whatever is inside these is never prose.
    .replace(/<(script|style|figure|figcaption|pre)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
      if (name.startsWith("#")) {
        const code =
          name[1] === "x" || name[1] === "X"
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : " ";
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= max) return text;
  // Cut at a word, not through one.
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/**
 * The article's first real image, to give the card a face.
 *
 * Tracking pixels and feed-burner badges are tiny or declare themselves so;
 * those are skipped rather than blown up to fill a card.
 */
export function leadImage(html: string): string | undefined {
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src || !/^https?:\/\//i.test(src)) continue;

    const width = Number(/\bwidth\s*=\s*["']?(\d+)/i.exec(tag)?.[1]);
    const height = Number(/\bheight\s*=\s*["']?(\d+)/i.exec(tag)?.[1]);
    if ((width > 0 && width < 80) || (height > 0 && height < 80)) continue;
    if (/pixel|tracker|feedburner|feeds\.feedblitz|\/stats?\//i.test(src)) continue;

    return src.replace(/&amp;/g, "&");
  }
  return undefined;
}
