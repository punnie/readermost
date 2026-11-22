import { useEffect, useRef } from "react";
import { Check, Star } from "lucide-react";

import { formatListDate } from "../format";
import { useRowSwipe } from "../swipe";

import type { Entry } from "../types";

interface Props {
  entries: Entry[];
  selectedId?: number;
  onSelect: (entry: Entry) => void;
  isLoading: boolean;
  title: string;
  /** Row swipes, on a phone: rightwards stars, leftwards toggles read. */
  onSwipe?: (entry: Entry, action: "star" | "read") => void;
}

export function EntryList({ entries, selectedId, onSelect, isLoading, title, onSwipe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useRowSwipe(containerRef, {
    enabled: Boolean(onSwipe),
    rowOf: (target) => target.closest<HTMLElement>(".entry-row"),
    onSwipe: (row, action) => {
      const entry = entries.find((candidate) => String(candidate.id) === row.dataset.entryId);
      if (entry) onSwipe?.(entry, action);
    },
  });

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
        // The track sits behind the row and shows through as it slides,
        // saying what letting go will do.
        <div key={entry.id} className="row-track">
          <span className="row-action row-action-star" aria-hidden="true">
            <Star size={18} fill="currentColor" />
            {entry.starred ? "Unstar" : "Star"}
          </span>
          <span className="row-action row-action-read" aria-hidden="true">
            {entry.status === "read" ? "Unread" : "Read"}
            <Check size={18} />
          </span>
          <button
            data-entry-id={entry.id}
            className={`entry-row ${entry.status === "read" ? "read" : ""} ${
              entry.id === selectedId ? "selected" : ""
            }`}
            onClick={() => onSelect(entry)}
          >
            <div className="entry-title">
              {entry.starred && (
                <Star className="star" size={12} fill="currentColor" aria-label="Starred" />
              )}
              {entry.title}
            </div>
            <div className="entry-meta">
              <span className="feed-name">{entry.feed?.title}</span>
              {/* Length is what decides whether to open it now, later, or never. */}
              {entry.reading_time > 0 && <span>{entry.reading_time} min</span>}
              <span>{formatListDate(entry.published_at)}</span>
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}
