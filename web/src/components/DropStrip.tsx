import { folderDropProps, type FeedDrag } from "../dnd";
import type { Tree } from "../types";

interface Props {
  tree?: Tree;
  drag?: FeedDrag;
  dropTarget?: number;
  setDropTarget: (categoryID: number | undefined) => void;
  onMove: (feedID: number, categoryID: number) => void;
}

/**
 * Every folder as a chip, pinned to the top of a scrolling list while a feed
 * is being dragged — so any folder is one short move away, however far down
 * the list it sits.
 *
 * It is mounted all the time and shown with a class, inside a zero-height
 * sticky anchor, so appearing neither shifts the rows under the pointer nor
 * changes layout mid-drag.
 */
export function DropStrip({ tree, drag, dropTarget, setDropTarget, onMove }: Props) {
  const folders = [...(tree?.categories ?? [])].sort((a, b) =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
  );

  return (
    <div className="drop-strip-anchor">
      <div className={`drop-strip ${drag ? "visible" : ""}`} aria-hidden={!drag}>
        <div className="drop-strip-label">Move to</div>
        <div className="drop-strip-chips">
          {folders.map((category) => {
            const isSource = drag?.fromCategoryID === category.id;
            return (
              <div
                key={category.id}
                className={`drop-chip ${isSource ? "source" : ""} ${
                  dropTarget === category.id && !isSource ? "active" : ""
                }`}
                title={isSource ? "Already in this folder" : `Move to ${category.title}`}
                {...(isSource ? {} : folderDropProps(category.id, onMove, setDropTarget))}
              >
                {category.title}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
