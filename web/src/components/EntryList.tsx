import { useEffect, useRef } from "react";

import { formatListDate } from "../format";

import type { Entry } from "../types";

interface Props {
  entries: Entry[];
  selectedId?: number;
  onSelect: (entry: Entry) => void;
  isLoading: boolean;
  title: string;
}

export function EntryList({ entries, selectedId, onSelect, isLoading, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation moves the selection; the list has to follow it.
  useEffect(() => {
    if (selectedId === undefined) return;
    const element = containerRef.current?.querySelector<HTMLElement>(
      `[data-entry-id="${selectedId}"]`,
    );
    element?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="pane entry-list" ref={containerRef}>
      {isLoading && <div className="loading">Loading…</div>}

      {!isLoading && entries.length === 0 && (
        <div className="empty">Nothing here. {title === "Unread" ? "All caught up." : ""}</div>
      )}

      {entries.map((entry) => (
        <button
          key={entry.id}
          data-entry-id={entry.id}
          className={`entry-row ${entry.status === "read" ? "read" : ""} ${
            entry.id === selectedId ? "selected" : ""
          }`}
          onClick={() => onSelect(entry)}
        >
          <div className="entry-title">
            {entry.starred && <span className="star">★ </span>}
            {entry.title}
          </div>
          <div className="entry-meta">
            <span className="feed-name">{entry.feed?.title}</span>
            <span>{formatListDate(entry.published_at)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
