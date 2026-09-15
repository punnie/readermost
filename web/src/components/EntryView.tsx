import { useEffect, useRef } from "react";

import { Avatar } from "./Avatar";
import { formatDate, formatDateTime } from "../format";
import { Thread } from "./Thread";
import type { Entry, ShareLookup } from "../types";

interface Props {
  entry?: Entry;
  /** Existing discussion for this article, if the channel already has one. */
  discussion?: ShareLookup;
  discussionLoading: boolean;
  /** Bump to reveal and focus the discussion, e.g. right after sharing. */
  focusDiscussion?: number;
  onToggleStar: (id: number) => void;
  onToggleRead: (entry: Entry) => void;
  onShare: (entry: Entry) => void;
  onDiscuss: (postId: string) => void;
}

export function EntryView({
  entry,
  discussion,
  discussionLoading,
  focusDiscussion = 0,
  onToggleStar,
  onToggleRead,
  onShare,
  onDiscuss,
}: Props) {
  const discussionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focusDiscussion > 0) {
      discussionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusDiscussion]);

  if (!entry) {
    return (
      <div className="pane reader">
        <div className="empty">
          Select an article, or press <kbd>j</kbd>.
        </div>
      </div>
    );
  }

  const shared = discussion?.shared ? discussion : undefined;
  const replies = shared?.reply_count ?? 0;
  const sharerName =
    shared?.author?.display_name || shared?.author?.username || "someone";

  return (
    <div className="pane reader">
      <article className="article">
        <h2>
          <a href={entry.url} target="_blank" rel="noreferrer noopener">
            {entry.title}
          </a>
        </h2>

        <div className="article-meta">
          {entry.feed?.title}
          {entry.author && ` · ${entry.author}`}
          {entry.published_at && ` · ${formatDateTime(entry.published_at)}`}
          {entry.reading_time > 0 && ` · ${entry.reading_time} min read`}
        </div>

        <div className="article-actions">
          {shared ? (
            <button className="btn" onClick={() => onDiscuss(shared.post_id!)}>
              {replies > 0
                ? `${replies} comment${replies === 1 ? "" : "s"} in the river`
                : "Show in the river"}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={discussionLoading}
              onClick={() => onShare(entry)}
            >
              Share to Mattermost
            </button>
          )}

          <button className="btn" onClick={() => onToggleStar(entry.id)}>
            {entry.starred ? "★ Starred" : "☆ Star"}
          </button>
          <button className="btn" onClick={() => onToggleRead(entry)}>
            Mark {entry.status === "read" ? "unread" : "read"}
          </button>
          <a className="btn" href={entry.url} target="_blank" rel="noreferrer noopener">
            Open original
          </a>
        </div>

        {/*
          Feed HTML is rendered as-is because Miniflux sanitises entry content
          server-side before it is ever stored. This app must never render
          untrusted HTML that has not been through that sanitiser.
        */}
        <div
          className="article-body"
          dangerouslySetInnerHTML={{ __html: entry.content }}
        />

        {/*
          The discussion lives with the article, so reading and arguing do not
          need two different places in the app.
        */}
        <section className="article-discussion" ref={discussionRef}>
          <h3>Discussion</h3>

          {shared ? (
            <>
              <div className="discussion-origin">
                <Avatar userId={shared.author!.user_id} name={sharerName} size={22} />
                <span>
                  Shared by <strong>{sharerName}</strong>
                  {shared.created_at
                    ? ` on ${formatDate(shared.created_at)}`
                    : null}
                </span>
                <a href={shared.permalink} target="_blank" rel="noreferrer noopener">
                  Mattermost ↗
                </a>
              </div>

              <Thread
                postId={shared.post_id!}
                replyCount={replies}
                expandedByDefault
                focusSignal={focusDiscussion}
                placeholder={replies ? "Reply…" : "Say something about this…"}
              />
            </>
          ) : (
            <div className="discussion-empty">
              {discussionLoading ? (
                "Checking the channel…"
              ) : (
                <>
                  <p>
                    Nobody has shared this yet. Share it to start a discussion your
                    friends can join — here or in Mattermost.
                  </p>
                  <button className="btn btn-primary" onClick={() => onShare(entry)}>
                    Share to Mattermost
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      </article>
    </div>
  );
}
