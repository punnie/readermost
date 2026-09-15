import { useEffect, useRef, useState } from "react";

import type { Entry } from "../types";

interface Props {
  entry: Entry;
  onCancel: () => void;
  onShare: (message: string) => Promise<void>;
}

export function ShareDialog({ entry, onCancel, onShare }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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
      <div className="dialog" role="dialog" aria-modal="true">
        <h3>Share to Mattermost</h3>

        <div className="shared-card" style={{ marginBottom: "12px" }}>
          <div className="title">{entry.title}</div>
          <div className="source">{entry.feed?.title}</div>
        </div>

        <textarea
          ref={textareaRef}
          rows={3}
          placeholder="Say something about it (optional)"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline.
            if (event.key === "Enter" && !event.shiftKey) {
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
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
