import { CheckCheck, RefreshCw, X } from "lucide-react";

import { ListMenu } from "./ListMenu";
import { UnreadCount } from "./UnreadCount";
import type { SortOrder } from "../sort";
import {
  LENGTH_LABELS,
  STATUS_LABELS,
  type LengthFilter,
  type StatusFilter,
} from "../filters";
import type { Selection, Tree } from "../types";

interface Props {
  selection: Selection;
  title: string;
  unread: number;
  tree?: Tree;
  sort: SortOrder;
  onSort: (order: SortOrder) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (filter: StatusFilter) => void;
  lengthFilter: LengthFilter;
  onLengthFilter: (filter: LengthFilter) => void;
  /** How many fetched articles the length filter is hiding. */
  filteredOut: number;
  /** Server-bound actions are disabled with no network. */
  online: boolean;
  /** Miniflux fetches in the background; say so while it does. */
  isRefreshing: boolean;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  onMoveFeed: (feedId: number, categoryId: number) => void;
  onUnsubscribe: (feedId: number, title: string) => void;
  onRenameFolder: (categoryId: number, title: string) => void;
  onDeleteFolder: (categoryId: number, title: string) => void;
  onSearchHere: (scope: Selection) => void;
}


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
  statusFilter,
  onStatusFilter,
  lengthFilter,
  onLengthFilter,
  filteredOut,
  online,
  isRefreshing,
  onMarkAllRead,
  onRefresh,
  onMoveFeed,
  onUnsubscribe,
  onRenameFolder,
  onDeleteFolder,
  onSearchHere,
}: Props) {
  const isRiver = selection.kind === "shared";

  return (
    <div className="list-toolbar">
      <div className="list-title">
        <span className="name" title={title}>
          {title}
        </span>
        <UnreadCount count={unread} />
      </div>

      {(statusFilter !== "all" || lengthFilter !== "any") && (
        <button
          className="filter-chip"
          title={
            filteredOut > 0
              ? `${filteredOut} loaded article${filteredOut === 1 ? "" : "s"} hidden by this filter`
              : "Filtering this list"
          }
          onClick={() => {
            onStatusFilter("all");
            onLengthFilter("any");
          }}
        >
          {[
            statusFilter !== "all" ? STATUS_LABELS[statusFilter] : null,
            lengthFilter !== "any" ? LENGTH_LABELS[lengthFilter].split(" · ")[0] : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          <X className="clear" size={12} aria-hidden="true" />
        </button>
      )}

      <button
        className="btn"
        onClick={onMarkAllRead}
        disabled={!online}
        title={online ? "Mark everything here as read" : "Needs a connection"}
      >
        <CheckCheck size={14} aria-hidden="true" />
        Mark all read
      </button>

      {!isRiver && (
        <button
          className="btn icon-only"
          aria-label="Refresh"
          onClick={onRefresh}
          disabled={!online || isRefreshing}
          title={
            isRefreshing
              ? "Fetching — this can take a while for many feeds"
              : online
                ? "Fetch new articles now"
                : "Needs a connection"
          }
        >
          <RefreshCw
            className={isRefreshing ? "spinning" : ""}
            size={14}
            aria-hidden="true"
          />
        </button>
      )}

      {!isRiver && (
        <ListMenu
          selection={selection}
          title={title}
          tree={tree}
          sort={sort}
          onSort={onSort}
          statusFilter={statusFilter}
          onStatusFilter={onStatusFilter}
          lengthFilter={lengthFilter}
          onLengthFilter={onLengthFilter}
          onMoveFeed={onMoveFeed}
          onUnsubscribe={onUnsubscribe}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onSearchHere={onSearchHere}
        />
      )}
    </div>
  );
}
