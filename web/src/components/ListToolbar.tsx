import { ListMenu } from "./ListMenu";
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
  onMarkAllRead: () => void;
  onRefresh: () => void;
  onMoveFeed: (feedId: number, categoryId: number) => void;
  onUnsubscribe: (feedId: number, title: string) => void;
  onRenameFolder: (categoryId: number, title: string) => void;
  onDeleteFolder: (categoryId: number, title: string) => void;
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
  onMarkAllRead,
  onRefresh,
  onMoveFeed,
  onUnsubscribe,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const isRiver = selection.kind === "shared";

  return (
    <div className="list-toolbar">
      <div className="list-title">
        <span className="name" title={title}>
          {title}
        </span>
        {unread > 0 && <span className="count">{unread}</span>}
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
          <span className="clear">×</span>
        </button>
      )}

      <button
        className="btn"
        onClick={onMarkAllRead}
        disabled={!online}
        title={online ? "Mark everything here as read" : "Needs a connection"}
      >
        Mark all read
      </button>

      {!isRiver && (
        <button
          className="btn"
          onClick={onRefresh}
          disabled={!online}
          title={online ? "Fetch new articles now" : "Needs a connection"}
        >
          ↻
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
        />
      )}
    </div>
  );
}
