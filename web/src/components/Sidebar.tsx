import { useRef, useState } from "react";

import { DropStrip } from "./DropStrip";
import { FeedIcon } from "./FeedIcon";
import { ContextMenu, MenuItem, MenuSeparator } from "./Menu";
import {
  feedDragProps,
  folderDropProps,
  useDragAutoScroll,
  useFeedDrag,
  useSpringLoadedFolders,
} from "../dnd";
import { useCollapsedFolders } from "../folders";
import type { Selection, Tree, TreeCategory } from "../types";

interface Props {
  tree?: Tree;
  riverUnread: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onNewFolder: () => void;
  /** Given both, right-clicking a folder offers to rename or delete it. */
  onRenameFolder?: (categoryId: number, title: string) => void;
  onDeleteFolder?: (categoryId: number, title: string) => void;
  /** Dragging is a desktop affordance; on touch it only blocks scrolling. */
  draggable?: boolean;
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
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFeed,
  draggable = true,
}: Props) {
  const navRef = useRef<HTMLElement>(null);
  const { collapsed, toggle, setAll } = useCollapsedFolders();
  // The folder a feed is currently hovering over, so the drop target is obvious.
  const [dropTarget, setDropTarget] = useState<number>();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    category: TreeCategory;
  }>();

  const anyDrag = useFeedDrag();
  // A drag in the Subscriptions dialog is not this list's business.
  const drag = draggable && anyDrag?.origin === "sidebar" ? anyDrag : undefined;
  const dragging = drag !== undefined;
  useDragAutoScroll(navRef, dragging);
  const peeked = useSpringLoadedFolders(dropTarget, collapsed, dragging);
  const canContextMenu = onRenameFolder !== undefined && onDeleteFolder !== undefined;

  const isSelected = (candidate: Selection) => {
    if (candidate.kind !== selection.kind) return false;
    if ("id" in candidate && "id" in selection) return candidate.id === selection.id;
    return true;
  };

  return (
    <nav className="pane sidebar" ref={navRef}>
      {draggable && (
        <DropStrip
          tree={tree}
          drag={drag}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onMove={onMoveFeed}
        />
      )}

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
          const isCollapsed = collapsed.has(category.id) && !peeked.has(category.id);

          return (
            <div
              key={category.id}
              className={dropTarget === category.id ? "drop-target" : ""}
              // The folder row and its feeds all accept a drop, meaning that folder.
              {...folderDropProps(category.id, onMoveFeed, setDropTarget)}
            >
              <div
                className={`nav-item folder ${
                  isSelected({ kind: "category", id: category.id }) ? "selected" : ""
                } ${category.unread > 0 ? "has-unread" : ""}`}
                onContextMenu={
                  canContextMenu
                    ? (event) => {
                        event.preventDefault();
                        setContextMenu({ x: event.clientX, y: event.clientY, category });
                      }
                    : undefined
                }
              >
                <button
                  className="twisty"
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${category.title}`}
                  title={isCollapsed ? "Expand" : "Collapse"}
                  onClick={() => toggle(category.id)}
                >
                  {isCollapsed ? "▶" : "▼"}
                </button>
                <button
                  className="nav-label"
                  onClick={() => onSelect({ kind: "category", id: category.id })}
                >
                  <span className="label">{category.title}</span>
                  {category.unread > 0 && <span className="count">{category.unread}</span>}
                </button>
              </div>

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
                    {...(draggable ? feedDragProps(feed.id, category.id, "sidebar") : {})}
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

      {contextMenu && canContextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(undefined)}
        >
          <MenuItem
            onClick={() => {
              onRenameFolder(contextMenu.category.id, contextMenu.category.title);
              setContextMenu(undefined);
            }}
          >
            Rename folder…
          </MenuItem>
          <MenuItem
            danger
            onClick={() => {
              onDeleteFolder(contextMenu.category.id, contextMenu.category.title);
              setContextMenu(undefined);
            }}
          >
            Delete folder…
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              setAll(tree?.categories.map((category) => category.id) ?? [], true);
              setContextMenu(undefined);
            }}
          >
            Collapse all folders
          </MenuItem>
          <MenuItem
            onClick={() => {
              setAll([], false);
              setContextMenu(undefined);
            }}
          >
            Expand all folders
          </MenuItem>
        </ContextMenu>
      )}
    </nav>
  );
}
