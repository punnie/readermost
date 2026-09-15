import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import type { SharedItem } from "../types";

interface Props {
  /** Post to scroll to and open, set when arriving from an article. */
  focusPostId?: string;
  onFocusHandled: () => void;
}

function timeAgo(millis: number): string {
  const seconds = Math.floor((Date.now() - millis) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(millis).toLocaleDateString();
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

function Thread({ postId, replyCount }: { postId: string; replyCount: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);

  // Only fetch a thread once someone wants to read it, or when it is short
  // enough that showing it costs little.
  const shouldLoad = expanded || replyCount > 0;

  const thread = useQuery({
    queryKey: ["thread", postId],
    queryFn: () => api.thread(postId),
    enabled: shouldLoad,
  });

  const comment = useMutation({
    mutationFn: (message: string) => api.comment(postId, message),
    onSuccess: () => {
      setDraft("");
      setExpanded(true);
      void queryClient.invalidateQueries({ queryKey: ["thread", postId] });
      void queryClient.invalidateQueries({ queryKey: ["shared"] });
      void queryClient.invalidateQueries({ queryKey: ["share-lookup"] });
    },
  });

  const replies = (thread.data?.messages ?? []).filter((message) => !message.is_root);
  const visible = expanded ? replies : replies.slice(-2);
  const hidden = replies.length - visible.length;

  return (
    <div className="thread">
      {hidden > 0 && (
        <button className="btn-link thread-more" onClick={() => setExpanded(true)}>
          Show {hidden} earlier comment{hidden === 1 ? "" : "s"}
        </button>
      )}

      {visible.map((message) => (
        <div className="thread-message" key={message.post_id}>
          <div className="meta">
            <strong>{message.author.display_name || message.author.username}</strong>
            <span>{timeAgo(message.created_at)}</span>
          </div>
          <div className="body">{message.message}</div>
        </div>
      ))}

      <form
        className="comment-form"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (message) comment.mutate(message);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={replies.length ? "Reply…" : "Start the discussion…"}
          disabled={comment.isPending}
        />
        <button className="btn" type="submit" disabled={comment.isPending || !draft.trim()}>
          {comment.isPending ? "…" : "Send"}
        </button>
      </form>

      {comment.isError && (
        <div className="error-banner" style={{ marginTop: "6px" }}>
          {comment.error instanceof Error ? comment.error.message : "Could not post"}
        </div>
      )}
    </div>
  );
}

function SharedRow({ item, focused }: { item: SharedItem; focused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const note = noteOf(item);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  return (
    <article ref={ref} className={`shared-item ${focused ? "focused" : ""}`}>
      <header className="shared-head">
        <span className="author">{item.author.display_name || item.author.username}</span>
        <span className="when">{timeAgo(item.created_at)}</span>
        <a
          className="permalink"
          href={item.permalink}
          target="_blank"
          rel="noreferrer noopener"
          title="Open this thread in Mattermost"
        >
          Mattermost ↗
        </a>
      </header>

      {note && <p className="shared-note">{note}</p>}

      {item.link && (
        <a
          className="shared-card"
          href={item.link.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          <div className="title">{item.link.title || item.link.url}</div>
          <div className="source">
            {item.link.feed_title || hostOf(item.link.url)}
            {item.link.author && ` · ${item.link.author}`}
            {item.link.published_at &&
              ` · ${new Date(item.link.published_at).toLocaleDateString()}`}
          </div>
          {item.link.excerpt && <p className="excerpt">{item.link.excerpt}</p>}
        </a>
      )}

      <Thread postId={item.post_id} replyCount={item.reply_count} />
    </article>
  );
}

export function SharedRiver({ focusPostId, onFocusHandled }: Props) {
  const shared = useQuery({ queryKey: ["shared"], queryFn: () => api.shared() });

  // Clear the focus request once it has been applied, so scrolling away and
  // back does not keep yanking the view.
  useEffect(() => {
    if (!focusPostId || !shared.data) return;
    const timer = window.setTimeout(onFocusHandled, 1500);
    return () => window.clearTimeout(timer);
  }, [focusPostId, shared.data, onFocusHandled]);

  if (shared.isLoading) return <div className="loading">Loading shared links…</div>;

  if (shared.isError) {
    return (
      <div className="empty">
        Could not load the shared channel.
        <br />
        {shared.error instanceof Error ? shared.error.message : null}
      </div>
    );
  }

  if (!shared.data?.items.length) {
    return (
      <div className="empty">
        Nothing shared yet. Press <kbd>S</kbd> on an article to start.
      </div>
    );
  }

  return (
    <div className="river">
      {shared.data.items.map((item) => (
        <SharedRow key={item.post_id} item={item} focused={item.post_id === focusPostId} />
      ))}
    </div>
  );
}
