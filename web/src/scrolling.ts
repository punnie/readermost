/**
 * How the phone's article screen responds to scrolling: the reading bar that
 * gets out of the way, the progress along its edge, and pulling past the end
 * of an article to go on to the next one.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

/** Downward travel, in pixels, before the bar tucks away. */
export const HIDE_AFTER = 24;

/** Upward travel that brings it back — small, so it is always one nudge away. */
export const SHOW_AFTER = 8;

/** How close to an end of the scroller counts as being there. */
const END_SLACK = 2;

export interface BarState {
  hidden: boolean;
  /** Travel in the current direction since it last changed; down is positive. */
  travel: number;
}

/**
 * The bar's next state after a scroll of `delta` pixels.
 *
 * Always shown at the top, where there is nothing to make room for, and at
 * the bottom, where the next step is exactly what it offers.
 */
export function nextBarState(
  state: BarState,
  delta: number,
  atTop: boolean,
  atBottom: boolean,
): BarState {
  if (atTop || atBottom) return { hidden: false, travel: 0 };
  if (delta === 0) return state;

  const sameDirection = Math.sign(delta) === Math.sign(state.travel);
  const travel = sameDirection ? state.travel + delta : delta;

  if (travel >= HIDE_AFTER) return { hidden: true, travel };
  if (travel <= -SHOW_AFTER) return { hidden: false, travel };
  return { hidden: state.hidden, travel };
}

/** 0 at the top, 1 at the bottom; a pane that does not scroll counts as read. */
export function scrollProgress(top: number, height: number, viewport: number): number {
  const range = height - viewport;
  if (range <= 0) return 1;
  return Math.min(1, Math.max(0, top / range));
}

/**
 * Tracks the reading bar's visibility and the reading progress for a
 * scroller. `key` names the article on screen: a new one starts with the bar
 * showing.
 */
export function useReadingScroll(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  key: string | undefined,
) {
  const [hidden, setHidden] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setHidden(false);
    const scroller = ref.current;
    if (!scroller || !enabled) return;

    let state: BarState = { hidden: false, travel: 0 };
    let last = scroller.scrollTop;
    let frame = 0;

    const update = () => {
      frame = 0;
      const top = scroller.scrollTop;
      const atTop = top <= END_SLACK;
      const atBottom = top + scroller.clientHeight >= scroller.scrollHeight - END_SLACK;
      state = nextBarState(state, top - last, atTop, atBottom);
      last = top;
      setHidden(state.hidden);
      setProgress(scrollProgress(top, scroller.scrollHeight, scroller.clientHeight));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [ref, enabled, key]);

  return { hidden, progress };
}

/** How far past the end a pull has to go before letting go advances. */
export const PULL_THRESHOLD = 96;

/** Resistance: the card moves at this fraction of the finger, like a rubber band. */
export const PULL_RESISTANCE = 0.5;

/** The visible pull for a finger that has travelled `distance` past the end. */
export function pullFor(distance: number): number {
  if (distance <= 0) return 0;
  return Math.min(distance * PULL_RESISTANCE, PULL_THRESHOLD * PULL_RESISTANCE * 1.4);
}

/** Has the pull gone far enough that letting go should advance? */
export function pullArmed(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}

/**
 * Pulling up past the end of the scroller, as one continuous motion with the
 * scroll that reached it. Returns the finger's travel past the end, for
 * drawing; letting go past the threshold calls `onAdvance`.
 *
 * Touch events rather than pointer events: once the browser owns a vertical
 * pan it cancels the pointer stream, but touch events keep coming.
 */
export function usePullToAdvance(
  ref: RefObject<HTMLElement | null>,
  options: { enabled: boolean; onAdvance: () => void },
) {
  const [distance, setDistance] = useState(0);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  }, [options]);

  useEffect(() => {
    const scroller = ref.current;
    if (!scroller || !options.enabled) return;

    /** Where the finger was when the scroller hit bottom, if it has. */
    let anchor: number | undefined;
    let travelled = 0;

    const atBottom = () =>
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - END_SLACK;

    const onTouchStart = (event: TouchEvent) => {
      travelled = 0;
      anchor = event.touches.length === 1 && atBottom() ? event.touches[0].clientY : undefined;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        anchor = undefined;
        travelled = 0;
        setDistance(0);
        return;
      }
      const y = event.touches[0].clientY;
      if (anchor === undefined) {
        // The same gesture can scroll down to the end and keep going.
        if (atBottom()) anchor = y;
        return;
      }
      travelled = Math.max(0, anchor - y);
      // Scrolled back up into the article: start again from the next bottom.
      if (!atBottom()) {
        anchor = undefined;
        travelled = 0;
      }
      setDistance(travelled);
    };

    const onTouchEnd = () => {
      const advance = pullArmed(travelled);
      anchor = undefined;
      travelled = 0;
      setDistance(0);
      if (advance) latest.current.onAdvance();
    };

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [ref, options.enabled]);

  return distance;
}
