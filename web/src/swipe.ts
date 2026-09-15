import { useEffect, useRef, type RefObject } from "react";

/** The left strip reserved for the drawer, where article swipes are ignored. */
export const EDGE_ZONE = 24;

/** How far a drag must travel before it counts as a swipe rather than a tap. */
export const MIN_DISTANCE = 60;

/** How much more horizontal than vertical a drag must be, so scrolls survive. */
export const DOMINANCE = 2;

export type SwipeVerdict = "none" | "previous" | "next";

export interface SwipeAttempt {
  /** Horizontal travel; positive is rightwards. */
  dx: number;
  /** Vertical travel. */
  dy: number;
  /** Where the gesture began, for the drawer's edge zone. */
  startX: number;
  /** More than one means a pinch, which is not a swipe. */
  pointers: number;
  /** Whether the gesture began inside something that scrolls sideways. */
  inScrollable: boolean;
}

/**
 * Should this drag change article?
 *
 * Kept separate from the event plumbing because every rule here is a judgement
 * call worth testing: each one exists to stop the gesture stealing something
 * else the reader was trying to do.
 */
export function swipeVerdict(attempt: SwipeAttempt): SwipeVerdict {
  const { dx, dy, startX, pointers, inScrollable } = attempt;

  // A pinch-zoom is not a swipe.
  if (pointers > 1) return "none";

  // The left edge belongs to the drawer.
  if (startX <= EDGE_ZONE) return "none";

  // A code block or wide table must scroll, not turn the page.
  if (inScrollable) return "none";

  if (Math.abs(dx) < MIN_DISTANCE) return "none";

  // Mostly-vertical drags are scrolls. A drag exactly on the ratio counts as a
  // scroll rather than a swipe: this guard exists to protect scrolling, so the
  // ambiguous case should go that way.
  if (Math.abs(dx) <= Math.abs(dy) * DOMINANCE) return "none";

  return dx > 0 ? "previous" : "next";
}

/**
 * Did the gesture start inside an element that scrolls horizontally?
 *
 * Articles are full of `<pre>` blocks and wide tables with `overflow-x: auto`.
 * Walking up from the touch target is the only way to tell a swipe on the page
 * from a swipe on a code block.
 */
export function startsInScrollable(target: Element | null, boundary: Element | null): boolean {
  let node: Element | null = target;

  while (node && node !== boundary) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

interface Options {
  onPrevious: () => void;
  onNext: () => void;
  enabled: boolean;
}

/**
 * Horizontal swipe over an element, using Pointer Events so touch and mouse
 * take the same path.
 *
 * The element is translated to follow the finger while the drag could still
 * become a swipe, so the gesture is visibly connected to what it does.
 */
export function useSwipeNavigation(ref: RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  }, [options]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !options.enabled) return;

    let startX = 0;
    let startY = 0;
    let pointers = 0;
    let scrollable = false;
    let tracking = false;

    const reset = (animate: boolean) => {
      element.style.transition = animate ? "transform 150ms ease-out" : "";
      element.style.transform = "";
      tracking = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      pointers += 1;
      if (pointers > 1) {
        reset(true);
        return;
      }
      startX = event.clientX;
      startY = event.clientY;
      scrollable = startsInScrollable(event.target as Element, element);
      tracking = true;
      element.style.transition = "";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking || pointers > 1) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      // Only follow the finger once the drag is clearly horizontal, so the
      // article does not twitch sideways while the reader is scrolling.
      const committed =
        !scrollable &&
        startX > EDGE_ZONE &&
        Math.abs(dx) > 12 &&
        Math.abs(dx) > Math.abs(dy) * DOMINANCE;

      if (committed) {
        element.style.transform = `translateX(${dx / 3}px)`;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const wasTracking = tracking;
      pointers = Math.max(0, pointers - 1);
      reset(true);
      if (!wasTracking) return;

      const verdict = swipeVerdict({
        dx: event.clientX - startX,
        dy: event.clientY - startY,
        startX,
        pointers: 1,
        inScrollable: scrollable,
      });

      if (verdict === "previous") latest.current.onPrevious();
      if (verdict === "next") latest.current.onNext();
    };

    const onPointerCancel = () => {
      pointers = Math.max(0, pointers - 1);
      reset(true);
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [ref, options.enabled]);
}
