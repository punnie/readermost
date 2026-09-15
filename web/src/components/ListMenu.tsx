import { Menu, MenuHeading, MenuItem, MenuSeparator } from "./Menu";
import { SORT_LABELS, type SortOrder } from "../sort";
import {
  LENGTH_LABELS,
  STATUS_LABELS,
  type LengthFilter,
  type StatusFilter,
} from "../filters";
import type { Selection, Tree } from "../types";

export interface ListMenuProps {
  selection: Selection;
  title: string;
  tree?: Tree;
  sort: SortOrder;
  onSort: (order: SortOrder) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (filter: StatusFilter) => void;
  lengthFilter: LengthFilter;
  onLengthFilter: (filter: LengthFilter) => void;
  onMoveFeed: (feedId: number, categoryId: number) => void;
  onUnsubscribe: (feedId: number, title: string) => void;
  onRenameFolder: (categoryId: number, title: string) => void;
  onDeleteFolder: (categoryId: number, title: string) => void;
  /** Extra items the phone's bar needs, since it has no room for buttons. */
  extra?: (close: () => void) => React.ReactNode;
}

const SORT_ORDERS: SortOrder[] = ["newest", "oldest", "magic"];
const STATUS_FILTERS: StatusFilter[] = ["all", "unread", "read"];
const LENGTH_FILTERS: LengthFilter[] = ["any", "quick", "medium", "long"];

/**
 * The options menu, shared by the desktop toolbar and the phone's bars so the
 * two cannot drift apart.
 */
export function ListMenu({
  selection,
  title,
  tree,
  sort,
  onSort,
  statusFilter,
  onStatusFilter,
  lengthFilter,
  onLengthFilter,
  onMoveFeed,
  onUnsubscribe,
  onRenameFolder,
  onDeleteFolder,
  extra,
}: ListMenuProps) {
  const isFeed = selection.kind === "feed";
  const isFolder = selection.kind === "category";

  const otherFolders = (tree?.categories ?? []).filter(
    (category) => !isFolder || category.id !== selection.id,
  );
  const canDeleteFolder = isFolder && otherFolders.length > 0;

  return (
    <Menu label="⋯" title="Options">
      {(close) => (
        <>
          {extra?.(close)}
          {(isFeed || isFolder) && (
            <>
              <MenuHeading>Show</MenuHeading>
              {STATUS_FILTERS.map((filter) => (
                <MenuItem
                  key={filter}
                  checked={statusFilter === filter}
                  onClick={() => {
                    onStatusFilter(filter);
                    close();
                  }}
                >
                  {STATUS_LABELS[filter]}
                </MenuItem>
              ))}

              <MenuSeparator />
              <MenuHeading>Length</MenuHeading>
              {LENGTH_FILTERS.map((filter) => (
                <MenuItem
                  key={filter}
                  checked={lengthFilter === filter}
                  title={
                    filter === "any"
                      ? undefined
                      : "Filters the articles already loaded, not the whole feed"
                  }
                  onClick={() => {
                    onLengthFilter(filter);
                    close();
                  }}
                >
                  {LENGTH_LABELS[filter]}
                </MenuItem>
              ))}

              <MenuSeparator />
            </>
          )}

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
                  onUnsubscribe(selection.id, title);
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
                  onRenameFolder(selection.id, title);
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
                  onDeleteFolder(selection.id, title);
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
  );
}
