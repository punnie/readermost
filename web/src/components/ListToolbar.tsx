import { Menu, MenuHeading, MenuItem, MenuSeparator } from "./Menu";
import { SORT_LABELS, type SortOrder } from "../sort";
import type { Selection, Tree } from "../types";

interface Props {
  selection: Selection;
  title: string;
  unread: number;
  tree?: Tree;
  sort: SortOrder;
  onSort: (order: SortOrder) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  onMoveFeed: (feedId: number, categoryId: number) => void;
  onUnsubscribe: (feedId: number, title: string) => void;
  onRenameFolder: (categoryId: number, title: string) => void;
  onDeleteFolder: (categoryId: number, title: string) => void;
}

const SORT_ORDERS: SortOrder[] = ["newest", "oldest", "magic"];

/**
 * The header over the entry list: what you are reading, and the actions that
 * belong to it.
 */
export function ListToolbar({
  selection,
  title,
  unread,
  tree,
  sort,
  onSort,
  onMarkAllRead,
  onRefresh,
  onMoveFeed,
  onUnsubscribe,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const isFeed = selection.kind === "feed";
  const isFolder = selection.kind === "category";
  const isRiver = selection.kind === "shared";

  // Folders other than this one, as move targets.
  const otherFolders = (tree?.categories ?? []).filter(
    (category) => !isFolder || category.id !== selection.id,
  );

  // Deleting the last folder would leave its feeds nowhere to go.
  const canDeleteFolder = isFolder && otherFolders.length > 0;

  return (
    <div className="list-toolbar">
      <div className="list-title">
        <span className="name" title={title}>
          {title}
        </span>
        {unread > 0 && <span className="count">{unread}</span>}
      </div>

      <button className="btn" onClick={onMarkAllRead} title="Mark everything here as read">
        Mark all read
      </button>

      {!isRiver && (
        <button className="btn" onClick={onRefresh} title="Fetch new articles now">
          ↻
        </button>
      )}

      {!isRiver && (
        <Menu label="▾" title="Options">
          {(close) => (
            <>
              <MenuHeading>Sort</MenuHeading>
              {SORT_ORDERS.map((order) => (
                <MenuItem
                  key={order}
                  checked={sort === order}
                  title={
                    order === "magic"
                      ? "Shuffles the articles already loaded, not the whole feed"
                      : undefined
                  }
                  onClick={() => {
                    onSort(order);
                    close();
                  }}
                >
                  {SORT_LABELS[order]}
                </MenuItem>
              ))}

              {isFeed && otherFolders.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuHeading>Move to folder</MenuHeading>
                  {otherFolders.map((category) => (
                    <MenuItem
                      key={category.id}
                      onClick={() => {
                        onMoveFeed(selection.id, category.id);
                        close();
                      }}
                    >
                      {category.title}
                    </MenuItem>
                  ))}
                </>
              )}

              {isFeed && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    onClick={() => {
                      onUnsubscribe(selection.id, selection.title);
                      close();
                    }}
                  >
                    Unsubscribe
                  </MenuItem>
                </>
              )}

              {isFolder && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    onClick={() => {
                      onRenameFolder(selection.id, selection.title);
                      close();
                    }}
                  >
                    Rename folder
                  </MenuItem>
                  <MenuItem
                    danger
                    disabled={!canDeleteFolder}
                    title={
                      canDeleteFolder
                        ? "The folder goes; its feeds move to another folder"
                        : "This is your only folder, so its feeds would have nowhere to go"
                    }
                    onClick={() => {
                      onDeleteFolder(selection.id, selection.title);
                      close();
                    }}
                  >
                    Delete folder
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Menu>
      )}
    </div>
  );
}
