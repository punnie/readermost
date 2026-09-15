import type { Entry } from "../types";

interface Props {
  entry?: Entry;
  onToggleStar: (id: number) => void;
  onToggleRead: (entry: Entry) => void;
  onShare: (entry: Entry) => void;
}

export function EntryView({ entry, onToggleStar, onToggleRead, onShare }: Props) {
  if (!entry) {
    return (
      <div className="pane reader">
        <div className="empty">Select an article, or press <kbd>j</kbd>.</div>
      </div>
    );
  }

  const published = new Date(entry.published_at);

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
          <button className="btn btn-primary" onClick={() => onShare(entry)}>
            Share to Mattermost
          </button>
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
      </article>
    </div>
  );
}
