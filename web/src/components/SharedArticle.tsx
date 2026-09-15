import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { Avatar } from "./Avatar";
import { Thread, timeAgo } from "./Thread";
import type { SharedItem, Tree } from "../types";

interface Props {
  item?: SharedItem;
  tree?: Tree;
  onSubscribe: (feedUrl: string, feedTitle: string) => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The sharer's own words, separated from the link markup the server appends.
 * A share is composed as "note\n\n[title](url)", so anything before the blank
 * line is what the person actually said.
 */
function noteOf(item: SharedItem): string {
  if (!item.link?.from_readermost) return item.message;
  const split = item.message.indexOf("\n\n");
  return split === -1 ? "" : item.message.slice(0, split).trim();
}

/** Whether the reader already follows this feed, answered from the loaded tree. */
function isSubscribed(tree: Tree | undefined, feedUrl?: string): boolean {
  if (!tree || !feedUrl) return false;
  return tree.categories.some((category) =>
    category.feeds.some((feed) => feed.feed_url === feedUrl),
  );
}

/** The right pane of the shared view: the article itself, then the discussion. */
export function SharedArticle({ item, tree, onSubscribe }: Props) {
  // The server resolves the text: the reader's own Miniflux if they subscribe,
  // otherwise the copy kept from whoever shared it.
  const article = useQuery({
    queryKey: ["shared-article", item?.post_id],
    queryFn: () => api.sharedArticle(item!.post_id),
    enabled: Boolean(item?.post_id),
  });

  if (!item) {
    return (
      <div className="pane reader">
        <div className="empty">
          Select a shared link, or press <kbd>j</kbd>.
        </div>
      </div>
    );
  }

  const name = item.author.display_name || item.author.username;
  const note = noteOf(item);
  const data = article.data;
  const feedUrl = data?.feed_url || item.link?.feed_url;
  const feedTitle = data?.feed_title || item.link?.feed_title || "";
  const subscribed = data?.subscribed || isSubscribed(tree, feedUrl);
  const url = data?.url ?? item.link?.url;

  return (
    <div className="pane reader">
      <article className="article">
        <h2>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer noopener">
              {data?.title || item.link?.title || url}
            </a>
          ) : (
            item.message
          )}
        </h2>

        <div className="article-meta">
          {feedTitle || (url ? hostOf(url) : null)}
          {data?.author && ` · ${data.author}`}
          {data?.published_at && ` · ${new Date(data.published_at).toLocaleDateString()}`}
          {data?.reading_time ? ` · ${data.reading_time} min read` : null}
        </div>

        <div className="shared-by">
          <Avatar userId={item.author.user_id} name={name} size={24} />
          <span>
            Shared by <strong>{name}</strong> {timeAgo(item.created_at)}
          </span>
          <a href={item.permalink} target="_blank" rel="noreferrer noopener">
            Mattermost ↗
          </a>
        </div>

        {note && <p className="shared-note">{note}</p>}

        <div className="article-actions">
          {url && (
            <a className="btn" href={url} target="_blank" rel="noreferrer noopener">
              Open original
            </a>
          )}
          {feedUrl && !subscribed && (
            <button
              className="btn btn-primary"
              onClick={() => onSubscribe(feedUrl, feedTitle)}
            >
              Subscribe to {feedTitle || hostOf(feedUrl)}
            </button>
          )}
          {data?.entry_id && (
            <button className="btn" onClick={() => void api.toggleBookmark(data.entry_id!)}>
              ☆ Star
            </button>
          )}
        </div>

        {article.isLoading ? (
          <div className="article-body">
            <p className="not-subscribed">Loading the article…</p>
          </div>
        ) : (
          /*
            This HTML came from Miniflux's sanitiser — either the reader's own
            account or the copy taken from the sharer's, which was sanitised
            the same way. Nothing else may be rendered here.
          */
          <div
            className="article-body"
            dangerouslySetInnerHTML={{ __html: data?.content ?? "" }}
          />
        )}

        {data?.content_source === "none" && !article.isLoading && (
          <p className="not-subscribed">
            Nobody who has this article has opened it here yet, so only the
            excerpt is available.
          </p>
        )}

        <section className="article-discussion">
          <h3>Discussion</h3>
          <Thread
            postId={item.post_id}
            replyCount={item.reply_count}
            expandedByDefault
            placeholder={item.reply_count ? "Reply…" : "Say something about this…"}
          />
        </section>
      </article>
    </div>
  );
}
