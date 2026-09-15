import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { Avatar } from "./Avatar";
import { timeAgo } from "../format";

interface Props {
  postId: string;
  replyCount: number;
  /** Show every reply immediately instead of the most recent few. */
  expandedByDefault?: boolean;
  placeholder?: string;
  /** Bump to focus the reply box; a counter so repeats still fire. */
  focusSignal?: number;
}

/** A shared link's comment thread, with its reply box. */
export function Thread({
  postId,
  replyCount,
  expandedByDefault = false,
  placeholder,
  focusSignal = 0,
}: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(expandedByDefault);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  const thread = useQuery({
    queryKey: ["thread", postId],
    queryFn: () => api.thread(postId),
    enabled: expanded || replyCount > 0,
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
          <Avatar
            userId={message.author.user_id}
            name={message.author.display_name || message.author.username}
            size={22}
          />
          <div className="thread-body">
            <div className="meta">
              <strong>{message.author.display_name || message.author.username}</strong>
              <span>{timeAgo(message.created_at)}</span>
            </div>
            <div className="body">{message.message}</div>
          </div>
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
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder ?? (replies.length ? "Reply…" : "Start the discussion…")}
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
