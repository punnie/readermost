import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import type { Tree } from "../types";

interface Props {
  tree?: Tree;
  onClose: () => void;
}

/** Subscription housekeeping: rename, move, unsubscribe, import and export. */
export function Settings({ tree, onClose }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
    void queryClient.invalidateQueries({ queryKey: ["entries"] });
  };

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api.updateFeed(id, { title }),
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number }) =>
      api.updateFeed(id, { category_id: categoryId }),
    onSuccess: invalidate,
  });

  const unsubscribe = useMutation({
    mutationFn: (id: number) => api.deleteFeed(id),
    onSuccess: invalidate,
  });

  const renameCategory = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api.updateCategory(id, title),
    onSuccess: invalidate,
  });

  const importOPML = useMutation({
    mutationFn: (file: File) => api.importOPML(file),
    onSuccess: (result) => {
      setStatus(result.message || "Import started.");
      invalidate();
    },
    onError: (error) =>
      setStatus(error instanceof Error ? error.message : "Import failed"),
  });

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" style={{ width: "min(680px, 100%)" }}>
        <h3>Subscriptions</h3>

        <div style={{ maxHeight: "50vh", overflowY: "auto", marginBottom: "12px" }}>
          {tree?.categories.map((category) => (
            <div key={category.id} style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <strong style={{ flex: 1 }}>{category.title}</strong>
                <button
                  className="btn-link"
                  onClick={() => {
                    const title = window.prompt("Rename folder", category.title);
                    if (title?.trim()) {
                      renameCategory.mutate({ id: category.id, title: title.trim() });
                    }
                  }}
                >
                  rename
                </button>
              </div>

              {category.feeds.map((feed) => (
                <div
                  key={feed.id}
                  style={{
                    display: "flex",
                    gap: "6px",
                    alignItems: "center",
                    padding: "3px 0 3px 12px",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={feed.error || feed.feed_url}
                  >
                    {feed.title}
                    {feed.error && <span className="feed-error"> !</span>}
                  </span>

                  <select
                    value={category.id}
                    onChange={(event) =>
                      move.mutate({ id: feed.id, categoryId: Number(event.target.value) })
                    }
                    style={{ fontSize: "11px" }}
                  >
                    {tree.categories.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
                      </option>
                    ))}
                  </select>

                  <button
                    className="btn-link"
                    onClick={() => {
                      const title = window.prompt("Rename feed", feed.title);
                      if (title?.trim()) rename.mutate({ id: feed.id, title: title.trim() });
                    }}
                  >
                    rename
                  </button>
                  <button
                    className="btn-link"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      if (window.confirm(`Unsubscribe from ${feed.title}?`)) {
                        unsubscribe.mutate(feed.id);
                      }
                    }}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <h3>Import and export</h3>
        <input
          ref={fileRef}
          type="file"
          accept=".opml,.xml,application/xml,text/xml"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importOPML.mutate(file);
          }}
        />
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn"
            disabled={importOPML.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {importOPML.isPending ? "Importing…" : "Import OPML"}
          </button>
          {/* A plain link: the browser downloads it with the server's filename. */}
          <a className="btn" href="/api/export">
            Export OPML
          </a>
        </div>

        {status && (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--text-muted)" }}>
            {status}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
