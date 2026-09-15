import type { DragEvent } from "react";

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

/** Props for a feed row, making it draggable. */
export function feedDragProps(feedID: number, fromCategoryID: number) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(FEED_TYPE, String(feedID));
      event.dataTransfer.setData(FROM_TYPE, String(fromCategoryID));
    },
  };
}

/**
 * Props for anything that accepts a dropped feed — a folder heading, or a feed
 * row standing in for the folder it sits in.
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
    onDragLeave: () => setActive(undefined),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setActive(undefined);

      const feedID = Number(event.dataTransfer.getData(FEED_TYPE));
      const from = Number(event.dataTransfer.getData(FROM_TYPE));
      // Dropping a feed back where it started is a no-op, not a request.
      if (!feedID || from === categoryID) return;
      onMove(feedID, categoryID);
    },
  };
}
