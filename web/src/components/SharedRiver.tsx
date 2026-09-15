import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import type { SharedItem } from "../types";

function timeAgo(millis: number): string {
  const seconds = Math.floor((Date.now() - millis) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(millis).toLocaleDateString();
}

function Thread({ postId, replyCount }: { postId: string; replyCount: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const thread = useQuery({
    queryKey: ["thread", postId],
    queryFn: () => api.thread(postId),
  });

  const comment = useMutation({
    mutationFn: (message: string) => api.comment(postId, message),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["thread", postId] });
      void queryClient.invalidateQueries({ queryKey: ["shared"] });
    },
  });

  return (
    <div className="thread">
      {thread.isLoading && <div style={{ color: "var(--text-faint)" }}>Loading…</div>}

      {thread.data?.messages
        .filter((message) => !message.is_root)
        .map((message) => (
          <div className="thread-message" key={message.post_id}>
            <div className="meta">
              <strong>{message.author.display_name || message.author.username}</strong>{" "}
              {timeAgo(message.created_at)}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{message.message}</div>
          </div>
        ))}

      {replyCount === 0 && !thread.isLoading && (
        <div style={{ color: "var(--text-faint)" }}>No comments yet.</div>
      )}

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
          placeholder="Reply…"
          disabled={comment.isPending}
        />
        <button className="btn" type="submit" disabled={comment.isPending || !draft.trim()}>
          Send
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

function SharedRow({ item }: { item: SharedItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="shared-item">
      <div className="shared-head">
        <span className="author">{item.author.display_name || item.author.username}</span>
        <span>{timeAgo(item.created_at)}</span>
        <span style={{ flex: 1 }} />
        <a href={item.permalink} target="_blank" rel="noreferrer noopener">
          in Mattermost
        </a>
      </div>

      {item.link && !item.link.from_readermost && (
        <div className="shared-note">{item.message}</div>
      )}
      {item.link?.from_readermost && item.message.includes("\n\n") && (
        <div className="shared-note">{item.message.split("\n\n")[0]}</div>
      )}
      {!item.link && <div className="shared-note">{item.message}</div>}

      {item.link && (
        <a
          className="shared-card"
          href={item.link.url}
          target="_blank"
          rel="noreferrer noopener"
          style={{ display: "block", textDecoration: "none", color: "inherit" }}
        >
          <div className="title">{item.link.title || item.link.url}</div>
          <div className="source">
            {item.link.feed_title || new URL(item.link.url).hostname}
            {item.link.author && ` · ${item.link.author}`}
          </div>
        </a>
      )}

      <div style={{ marginTop: "8px" }}>
        <button className="btn-link" onClick={() => setOpen((value) => !value)}>
          {open
            ? "Hide comments"
            : item.reply_count > 0
              ? `${item.reply_count} comment${item.reply_count === 1 ? "" : "s"}`
              : "Comment"}
        </button>
      </div>

      {open && <Thread postId={item.post_id} replyCount={item.reply_count} />}
    </div>
  );
}

/**
 * The shared river is the configured Mattermost channel, rendered. Readermost
 * stores nothing about shares, so a link pasted straight into Mattermost shows
 * up here exactly like one shared from the reader.
 */
export function SharedRiver() {
  const shared = useQuery({ queryKey: ["shared"], queryFn: () => api.shared() });

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
    return <div className="empty">Nothing shared yet. Press S on an article to start.</div>;
  }

  return (
    <div>
      {shared.data.items.map((item) => (
        <SharedRow key={item.post_id} item={item} />
      ))}
    </div>
  );
}
