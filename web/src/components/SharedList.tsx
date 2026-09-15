import { useEffect, useRef } from "react";

import { Avatar } from "./Avatar";
import { timeAgo } from "../format";
import type { SharedItem } from "../types";

interface Props {
  items: SharedItem[];
  selectedId?: string;
  onSelect: (item: SharedItem) => void;
  isLoading: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The middle pane of the shared view — the same shape as the entry list. */
export function SharedList({ items, selectedId, onSelect, isLoading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation moves the selection; the list has to follow it.
  useEffect(() => {
    if (!selectedId) return;
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-post-id="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (isLoading) {
    return (
      <div className="pane entry-list">
        <div className="loading">Loading shared links…</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="pane entry-list">
        <div className="empty">
          Nothing shared yet. Press <kbd>S</kbd> on an article to start.
        </div>
      </div>
    );
  }

  return (
    <div className="pane entry-list" ref={containerRef}>
      {items.map((item) => {
        const name = item.author.display_name || item.author.username;
        const title = item.link?.title || item.link?.url || item.message;

        return (
          <button
            key={item.post_id}
            data-post-id={item.post_id}
            className={`entry-row shared-row ${item.read ? "read" : ""} ${
              item.post_id === selectedId ? "selected" : ""
            }`}
            onClick={() => onSelect(item)}
          >
            <div className="entry-title">{title}</div>
            <div className="entry-meta">
              <Avatar userId={item.author.user_id} name={name} size={16} />
              <span className="feed-name">
                {name}
                {item.link && ` · ${item.link.feed_title || hostOf(item.link.url)}`}
              </span>
              {item.unseen_replies > 0 && (
                <span className="reply-badge" title={`${item.unseen_replies} new comment(s)`}>
                  {item.unseen_replies}
                </span>
              )}
              <span>{timeAgo(item.created_at)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
