import { useEffect, useRef, type RefObject } from "react";

/**
 * Swipes on list rows: star one way, mark read the other.
 *
 * Swiping the whole article sideways used to mean next/previous, which fought
 * the browser's own edge-swipe for back and pulled against the vertical habit
 * of reading on a phone. Rows are a better home for it: the gesture acts on a
 * thing you can see, and deciding from the list saves opening a long article
 * just to dismiss it.
 */

/** Strips at both edges left to the system's back and forward gestures. */
export const EDGE_ZONE = 24;

/** How far a row must travel before letting go acts on it. */
export const ACTION_DISTANCE = 72;

/** How much more horizontal than vertical a drag must be, so scrolls survive. */
export const DOMINANCE = 2;

/** Travel before the row starts following the finger, so taps stay taps. */
export const SLOP = 10;

export type RowSwipe = "none" | "star" | "read";

export interface RowSwipeAttempt {
  /** Horizontal travel; positive is rightwards. */
  dx: number;
  /** Vertical travel. */
  dy: number;
  /** Where the gesture began, and how wide the screen is, for the edge zones. */
  startX: number;
  width: number;
  /** More than one means a pinch, which is not a swipe. */
  pointers: number;
}

/** Has the drag become a row swipe, as opposed to a scroll or a tap? */
export function swipeCommitted({ dx, dy, startX, width, pointers }: RowSwipeAttempt): boolean {
  if (pointers > 1) return false;
  if (startX <= EDGE_ZONE || startX >= width - EDGE_ZONE) return false;
  if (Math.abs(dx) < SLOP) return false;
  // Exactly on the ratio counts as a scroll: this guard exists to protect
  // scrolling, so the ambiguous case should go that way.
  return Math.abs(dx) > Math.abs(dy) * DOMINANCE;
}

/**
 * What letting go of a row does. Rightwards stars, leftwards marks read — the
 * same sides as most mail apps' flag and archive.
 */
export function rowSwipeVerdict(attempt: RowSwipeAttempt): RowSwipe {
  if (!swipeCommitted(attempt)) return "none";
  if (Math.abs(attempt.dx) < ACTION_DISTANCE) return "none";
  return attempt.dx > 0 ? "star" : "read";
}

interface Options {
  /** Which row a gesture started on, from the element under the finger. */
  rowOf: (target: Element) => HTMLElement | null;
  onSwipe: (row: HTMLElement, action: Exclude<RowSwipe, "none">) => void;
  enabled: boolean;
}

/**
 * Row swipes over a list, delegated from its container.
 *
 * The row slides with the finger once the drag is clearly sideways, revealing
 * its parent behind it — the track, which shows what letting go will do,
 * styled from `data-swipe` and `data-armed`. A swipe that
 * acted swallows the click that follows, so it does not also open the article.
 */
export function useRowSwipe(ref: RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  }, [options]);

  useEffect(() => {
    const container = ref.current;
    if (!container || !options.enabled) return;

    let row: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let pointers = 0;
    let committed = false;
    let swallowClick = false;

    const attempt = (event: PointerEvent): RowSwipeAttempt => ({
      dx: event.clientX - startX,
      dy: event.clientY - startY,
      startX,
      width: window.innerWidth,
      pointers,
    });

    const release = (animate: boolean) => {
      if (!row) return;
      const slider = row;
      slider.style.transition = animate ? "transform 160ms ease-out" : "";
      slider.style.transform = "";
      const track = slider.parentElement;
      if (track) {
        delete track.dataset.swipe;
        delete track.dataset.armed;
      }
      row = null;
      committed = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      pointers += 1;
      if (pointers > 1) {
        release(true);
        return;
      }
      row = latest.current.rowOf(event.target as Element);
      startX = event.clientX;
      startY = event.clientY;
      committed = false;
      if (row) row.style.transition = "";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!row || pointers > 1) return;
      const current = attempt(event);
      if (!committed) {
        // A drag that starts vertical is a scroll for its whole life.
        if (Math.abs(current.dy) > SLOP && !swipeCommitted(current)) {
          row = null;
          return;
        }
        committed = swipeCommitted(current);
        if (!committed) return;
      }
      row.style.transform = `translateX(${current.dx}px)`;
      const track = row.parentElement;
      if (track) {
        track.dataset.swipe = current.dx > 0 ? "star" : "read";
        if (Math.abs(current.dx) >= ACTION_DISTANCE) track.dataset.armed = "";
        else delete track.dataset.armed;
      }
    };

    const onPointerEnd = (event: PointerEvent, cancelled: boolean) => {
      const target = row;
      const wasCommitted = committed;
      const verdict = target && !cancelled ? rowSwipeVerdict(attempt(event)) : "none";
      pointers = Math.max(0, pointers - 1);
      release(true);
      if (wasCommitted) swallowClick = true;
      if (target && verdict !== "none") latest.current.onSwipe(target, verdict);
    };

    const onPointerUp = (event: PointerEvent) => onPointerEnd(event, false);
    const onPointerCancel = (event: PointerEvent) => onPointerEnd(event, true);

    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    // Any fresh touch clears a click that never came.
    const onTouchStart = () => {
      swallowClick = false;
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerCancel);
    container.addEventListener("click", onClick, true);
    container.addEventListener("touchstart", onTouchStart, { passive: true });

    return () => {
      release(false);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("click", onClick, true);
      container.removeEventListener("touchstart", onTouchStart);
    };
  }, [ref, options.enabled]);
}
