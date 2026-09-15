import { useState } from "react";

import { FeedIcon } from "./FeedIcon";
import { feedDragProps, folderDropProps } from "../dnd";
import type { Selection, Tree } from "../types";

interface Props {
  tree?: Tree;
  riverUnread: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  collapsed: Set<number>;
  onToggleCollapse: (categoryId: number) => void;
  onNewFolder: () => void;
  /** Move a feed into a folder, from a drag or a drop. */
  onMoveFeed: (feedId: number, categoryId: number) => void;
}

/**
 * The folder tree. Miniflux categories are flat, so this is exactly two levels —
 * which is also what Google Reader's folders were.
 */
export function Sidebar({
  tree,
  riverUnread,
  selection,
  onSelect,
  collapsed,
  onToggleCollapse,
  onNewFolder,
  onMoveFeed,
}: Props) {
  // The folder a feed is currently hovering over, so the drop target is obvious.
  const [dropTarget, setDropTarget] = useState<number>();

  const isSelected = (candidate: Selection) => {
    if (candidate.kind !== selection.kind) return false;
    if ("id" in candidate && "id" in selection) return candidate.id === selection.id;
    return true;
  };

  /** The folder row and its feeds all accept a drop, meaning that folder. */
  const dropHandlers = (categoryId: number) =>
    folderDropProps(categoryId, onMoveFeed, setDropTarget);

  return (
    <nav className="pane sidebar">
      <div className="nav-section">
        <button
          className={`nav-item ${isSelected({ kind: "shared" }) ? "selected" : ""} ${
            riverUnread > 0 ? "has-unread" : ""
          }`}
          onClick={() => onSelect({ kind: "shared" })}
        >
          <span className="twisty" />
          <span className="label">Shared by friends</span>
          {riverUnread > 0 && <span className="count">{riverUnread}</span>}
        </button>
      </div>

      <div className="nav-section">
        <button
          className={`nav-item ${isSelected({ kind: "unread" }) ? "selected" : ""} ${
            tree && tree.total_unread > 0 ? "has-unread" : ""
          }`}
          onClick={() => onSelect({ kind: "unread" })}
        >
          <span className="twisty" />
          <span className="label">Unread</span>
          {tree && tree.total_unread > 0 && (
            <span className="count">{tree.total_unread}</span>
          )}
        </button>

        <button
          className={`nav-item ${isSelected({ kind: "all" }) ? "selected" : ""}`}
          onClick={() => onSelect({ kind: "all" })}
        >
          <span className="twisty" />
          <span className="label">All items</span>
        </button>

        <button
          className={`nav-item ${isSelected({ kind: "starred" }) ? "selected" : ""}`}
          onClick={() => onSelect({ kind: "starred" })}
        >
          <span className="twisty" />
          <span className="label">Starred</span>
        </button>
      </div>

      <div className="nav-section">
        <div className="nav-heading">
          <span>Subscriptions</span>
          <button className="heading-action" onClick={onNewFolder} title="New folder">
            + Folder
          </button>
        </div>

        {tree?.categories.map((category) => {
          const isCollapsed = collapsed.has(category.id);
          const handlers = dropHandlers(category.id);

          return (
            <div key={category.id} className={dropTarget === category.id ? "drop-target" : ""}>
              <button
                className={`nav-item ${
                  isSelected({ kind: "category", id: category.id })
                    ? "selected"
                    : ""
                } ${category.unread > 0 ? "has-unread" : ""}`}
                onClick={() =>
                  onSelect({ kind: "category", id: category.id })
                }
                {...handlers}
              >
                <span
                  className="twisty"
                  onClick={(event) => {
                    // Toggling open/closed must not also change the selection.
                    event.stopPropagation();
                    onToggleCollapse(category.id);
                  }}
                  role="presentation"
                >
                  {isCollapsed ? "▶" : "▼"}
                </span>
                <span className="label">{category.title}</span>
                {category.unread > 0 && <span className="count">{category.unread}</span>}
              </button>

              {!isCollapsed &&
                category.feeds.map((feed) => (
                  <button
                    key={feed.id}
                    className={`nav-item feed ${
                      isSelected({ kind: "feed", id: feed.id })
                        ? "selected"
                        : ""
                    } ${feed.unread > 0 ? "has-unread" : ""}`}
                    onClick={() => onSelect({ kind: "feed", id: feed.id })}
                    title={feed.error || feed.title}
                    {...feedDragProps(feed.id, category.id)}
                    // A feed dropped onto a sibling means the folder it is in.
                    {...handlers}
                  >
                    <FeedIcon feedId={feed.id} hasIcon={feed.has_icon} />
                    <span className="label">{feed.title}</span>
                    {feed.error && (
                      <span className="feed-error" title={feed.error}>
                        !
                      </span>
                    )}
                    {feed.unread > 0 && <span className="count">{feed.unread}</span>}
                  </button>
                ))}
            </div>
          );
        })}

        {tree?.categories.length === 0 && (
          <div className="empty" style={{ padding: "12px", fontSize: "12px" }}>
            No subscriptions yet.
          </div>
        )}
      </div>
    </nav>
  );
}
