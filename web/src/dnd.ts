import { useEffect, useState, useSyncExternalStore, type DragEvent, type RefObject } from "react";

/**
 * Dragging a feed into a folder, shared by the sidebar and the Subscriptions
 * dialog so the two cannot drift apart.
 *
 * Custom MIME types rather than "text/plain": they keep a feed dragged out of
 * Readermost from being dropped into an unrelated text field as a stray number,
 * and keep text dragged in from elsewhere out of the folder tree.
 */
const FEED_TYPE = "application/x-readermost-feed";
const FROM_TYPE = "application/x-readermost-from";

/** The feed being dragged right now, if any. */
export interface FeedDrag {
  feedID: number;
  fromCategoryID: number;
  /** Which list it started in, so only that list's folder strip shows. */
  origin: DragOrigin;
}

export type DragOrigin = "sidebar" | "subscriptions";

/*
 * dataTransfer can only be read on drop, so the rest of the UI — the folder
 * strip, auto-scroll, spring-loaded folders — learns about a drag from here.
 */
let activeDrag: FeedDrag | undefined;
const dragListeners = new Set<() => void>();

function setActiveDrag(next: FeedDrag | undefined) {
  if (activeDrag === next) return;
  activeDrag = next;
  dragListeners.forEach((listener) => listener());
}

/** The feed being dragged, for anything that changes while a drag is on. */
export function useFeedDrag(): FeedDrag | undefined {
  return useSyncExternalStore(
    (listener) => {
      dragListeners.add(listener);
      return () => dragListeners.delete(listener);
    },
    () => activeDrag,
    () => undefined,
  );
}

/** Props for a feed row, making it draggable. */
export function feedDragProps(feedID: number, fromCategoryID: number, origin: DragOrigin) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(FEED_TYPE, String(feedID));
      event.dataTransfer.setData(FROM_TYPE, String(fromCategoryID));
      // Chrome cancels a drag whose source changes layout during dragstart,
      // and announcing it shows the folder strip; wait a tick.
      window.setTimeout(() => setActiveDrag({ feedID, fromCategoryID, origin }), 0);
    },
    // A successful drop moves the row, unmounting it, so dragend can miss;
    // the drop handler below clears the drag too.
    onDragEnd: () => setActiveDrag(undefined),
  };
}

/**
 * Props for anything that accepts a dropped feed — a folder heading, a chip in
 * the folder strip, or a feed row standing in for the folder it sits in.
 */
export function folderDropProps(
  categoryID: number,
  onMove: (feedID: number, categoryID: number) => void,
  setActive: (categoryID: number | undefined) => void,
) {
  return {
    onDragOver: (event: DragEvent) => {
      // Without preventDefault the browser refuses the drop entirely.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setActive(categoryID);
    },
    onDragLeave: (event: DragEvent) => {
      // Moving between a target's own children is not leaving it; treating it
      // so made the highlight flicker and restarted spring-loading.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setActive(undefined);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      // The innermost target decides; a chip or row must not also count as
      // a drop on whatever contains it.
      event.stopPropagation();
      setActive(undefined);
      setActiveDrag(undefined);

      const feedID = Number(event.dataTransfer.getData(FEED_TYPE));
      const from = Number(event.dataTransfer.getData(FROM_TYPE));
      // Dropping a feed back where it started is a no-op, not a request.
      if (!feedID || from === categoryID) return;
      onMove(feedID, categoryID);
    },
  };
}

/** How close to an edge, in pixels, a dragged feed starts the list scrolling. */
export const SCROLL_ZONE = 80;
/** Pixels per frame at the very edge. */
export const SCROLL_MAX_SPEED = 22;

/**
 * Scroll speed for a pointer at y in a list spanning top..bottom: zero in the
 * middle, ramping up through the edge zones, negative meaning up. The browser's
 * own drag scrolling only kicks in a few pixels from the edge, at one speed,
 * which made moving a feed down a long list a precision job.
 */
export function autoScrollSpeed(
  y: number,
  top: number,
  bottom: number,
  zone = SCROLL_ZONE,
  max = SCROLL_MAX_SPEED,
): number {
  if (y < top || y > bottom) return 0;
  // A short list cannot have two zones overlapping in the middle.
  const reach = Math.min(zone, (bottom - top) / 2);
  if (reach <= 0) return 0;

  if (y < top + reach) return -Math.ceil(max * ((top + reach - y) / reach));
  if (y > bottom - reach) return Math.ceil(max * ((y - (bottom - reach)) / reach));
  return 0;
}

/**
 * Scroll the element while a feed is dragged near its top or bottom edge. The
 * top zone starts below the folder strip, so hovering a chip drops rather than
 * scrolls.
 */
export function useDragAutoScroll(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;

    let pointer: { x: number; y: number; over: boolean } | undefined;
    const onDragOver = (event: globalThis.DragEvent) => {
      // Over the element itself, not merely inside its rectangle: a dialog's
      // backdrop covering the sidebar must not scroll the sidebar beneath it.
      const over = element.contains(event.target as Node | null);
      pointer = { x: event.clientX, y: event.clientY, over };
    };
    document.addEventListener("dragover", onDragOver);

    let frame = 0;
    const tick = () => {
      if (pointer?.over) {
        const rect = element.getBoundingClientRect();
        const strip = element.querySelector<HTMLElement>(".drop-strip");
        const top = Math.max(rect.top, strip?.getBoundingClientRect().bottom ?? rect.top);
        const speed = autoScrollSpeed(pointer.y, top, rect.bottom);
        if (speed) element.scrollTop += speed;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      document.removeEventListener("dragover", onDragOver);
      window.cancelAnimationFrame(frame);
    };
  }, [ref, active]);
}

/** How long a dragged feed must hover a collapsed folder before it opens. */
const SPRING_DELAY = 600;

/**
 * Spring-loaded folders: hovering a dragged feed over a collapsed folder opens
 * it for the rest of the drag, as file managers do. The opening is temporary —
 * once the drag ends the folder goes back to how the reader left it.
 */
export function useSpringLoadedFolders(
  dropTarget: number | undefined,
  collapsed: Set<number>,
  dragging: boolean,
): Set<number> {
  const [peeked, setPeeked] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!dragging) setPeeked((current) => (current.size ? new Set() : current));
  }, [dragging]);

  useEffect(() => {
    if (!dragging || dropTarget === undefined) return;
    if (!collapsed.has(dropTarget) || peeked.has(dropTarget)) return;

    const timer = window.setTimeout(
      () => setPeeked((current) => new Set(current).add(dropTarget)),
      SPRING_DELAY,
    );
    return () => window.clearTimeout(timer);
  }, [dropTarget, collapsed, dragging, peeked]);

  return peeked;
}
