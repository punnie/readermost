import { useEffect, useRef, useState } from "react";

import { useIsMobile } from "../useIsMobile";
import type { Entry } from "../types";

interface Props {
  entry: Entry;
  onCancel: () => void;
  onShare: (message: string) => Promise<void>;
}

export function ShareDialog({ entry, onCancel, onShare }: Props) {
  const isMobile = useIsMobile();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Only steal focus on a desktop. On a phone this throws the keyboard up
    // over the article you are about to talk about, before you have even seen
    // what you are sharing.
    if (!isMobile) textareaRef.current?.focus();
  }, [isMobile]);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onShare(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sharing failed");
      setBusy(false);
    }
  };

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog share-dialog" role="dialog" aria-modal="true">
        <h3>Share to Mattermost</h3>

        <div className="shared-card" style={{ marginBottom: "12px" }}>
          <div className="title">{entry.title}</div>
          <div className="source">{entry.feed?.title}</div>
        </div>

        <textarea
          ref={textareaRef}
          rows={isMobile ? 5 : 3}
          placeholder="Say something about it (optional)"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends on a desktop, where Shift+Enter gives a newline. On a
            // touch keyboard Return *is* the newline key, so hijacking it makes
            // a multi-line note impossible to type; the Share button sends.
            if (!isMobile && event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape") onCancel();
          }}
        />

        {error && (
          <div className="error-banner" style={{ marginTop: "8px" }}>
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
