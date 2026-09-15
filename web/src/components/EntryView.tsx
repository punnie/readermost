import type { Entry, ShareLookup } from "../types";

interface Props {
  entry?: Entry;
  /** Existing discussion for this article, if the channel already has one. */
  discussion?: ShareLookup;
  discussionLoading: boolean;
  onToggleStar: (id: number) => void;
  onToggleRead: (entry: Entry) => void;
  onShare: (entry: Entry) => void;
  onDiscuss: (postId: string) => void;
}

export function EntryView({
  entry,
  discussion,
  discussionLoading,
  onToggleStar,
  onToggleRead,
  onShare,
  onDiscuss,
}: Props) {
  if (!entry) {
    return (
      <div className="pane reader">
        <div className="empty">
          Select an article, or press <kbd>j</kbd>.
        </div>
      </div>
    );
  }

  const published = new Date(entry.published_at);
  const replies = discussion?.reply_count ?? 0;

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
          {!Number.isNaN(published.getTime()) && ` · ${published.toLocaleString()}`}
          {entry.reading_time > 0 && ` · ${entry.reading_time} min read`}
        </div>

        <div className="article-actions">
          {discussion?.shared ? (
            <button
              className="btn btn-primary"
              onClick={() => onDiscuss(discussion.post_id!)}
            >
              {replies > 0
                ? `Discuss — ${replies} comment${replies === 1 ? "" : "s"}`
                : "Discuss"}
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

        {discussion?.shared && (
          <div className="shared-hint">
            Shared by{" "}
            <strong>
              {discussion.author?.display_name || discussion.author?.username || "someone"}
            </strong>
            {discussion.created_at
              ? ` on ${new Date(discussion.created_at).toLocaleDateString()}`
              : null}
            .{" "}
            <a href={discussion.permalink} target="_blank" rel="noreferrer noopener">
              Open in Mattermost
            </a>
          </div>
        )}

        {/*
          Feed HTML is rendered as-is because Miniflux sanitises entry content
          server-side before it is ever stored. This app must never render
          untrusted HTML that has not been through that sanitiser.
        */}
        <div
          className="article-body"
          dangerouslySetInnerHTML={{ __html: entry.content }}
        />
      </article>
    </div>
  );
}
