import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { feedDragProps, folderDropProps } from "../dnd";
import { useMoveFeed } from "../hooks";
import { FeedIcon } from "./FeedIcon";
import { Icon } from "./Icon";
import type { Tree } from "../types";

interface Props {
  tree?: Tree;
  onClose: () => void;
}

/** Subscription housekeeping: drag feeds between folders, rename, unsubscribe. */
export function Settings({ tree, onClose }: Props) {
  const queryClient = useQueryClient();
  const moveFeed = useMoveFeed();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>();
  const [dropTarget, setDropTarget] = useState<number>();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
    void queryClient.invalidateQueries({ queryKey: ["entries"] });
  };

  const renameFeed = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api.updateFeed(id, { title }),
    onSuccess: invalidate,
  });

  const unsubscribe = useMutation({
    mutationFn: (id: number) => api.deleteFeed(id),
    onSuccess: invalidate,
  });

  const createCategory = useMutation({
    mutationFn: (title: string) => api.createCategory(title),
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

  const totalFeeds = tree?.categories.reduce((sum, c) => sum + c.feeds.length, 0) ?? 0;

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog subscriptions" role="dialog" aria-modal="true">
        <header className="subs-header">
          <h3>Subscriptions</h3>
          <span className="subs-count">
            {totalFeeds} feed{totalFeeds === 1 ? "" : "s"} in{" "}
            {tree?.categories.length ?? 0} folders
          </span>
          <button
            className="btn"
            onClick={() => {
              const title = window.prompt("New folder name");
              if (title?.trim()) createCategory.mutate(title.trim());
            }}
          >
            New folder
          </button>
        </header>

        <p className="subs-hint">Drag a feed onto a folder to move it.</p>

        <div className="subs-list">
          {tree?.categories.map((category) => {
            const drop = folderDropProps(category.id, moveFeed, setDropTarget);

            return (
              <section
                key={category.id}
                className={`subs-folder ${dropTarget === category.id ? "drop-target" : ""}`}
                {...drop}
              >
                <div className="subs-folder-head">
                  <Icon name="folder" />
                  <span className="name">{category.title}</span>
                  <span className="subs-count">{category.feeds.length}</span>
                  <button
                    className="icon-btn"
                    aria-label={`Rename the folder ${category.title}`}
                    title="Rename folder"
                    onClick={() => {
                      const title = window.prompt("Rename folder", category.title);
                      if (title?.trim()) {
                        renameCategory.mutate({ id: category.id, title: title.trim() });
                      }
                    }}
                  >
                    <Icon name="pencil" />
                  </button>
                </div>

                {category.feeds.length === 0 && (
                  <div className="subs-empty">Empty — drop a feed here</div>
                )}

                {category.feeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="subs-feed"
                    {...feedDragProps(feed.id, category.id)}
                    // A feed row stands in for the folder it sits in, so
                    // dropping onto a sibling does the obvious thing.
                    {...drop}
                  >
                    <span className="grip" title="Drag to another folder">
                      <Icon name="grip" size={14} />
                    </span>
                    <FeedIcon feedId={feed.id} hasIcon={feed.has_icon} />
                    <span className="name" title={feed.error || feed.feed_url}>
                      {feed.title}
                    </span>
                    {feed.error && (
                      <span className="feed-error" title={feed.error}>
                        !
                      </span>
                    )}

                    <button
                      className="icon-btn"
                      aria-label={`Rename ${feed.title}`}
                      title="Rename feed"
                      onClick={() => {
                        const title = window.prompt("Rename feed", feed.title);
                        if (title?.trim()) renameFeed.mutate({ id: feed.id, title: title.trim() });
                      }}
                    >
                      <Icon name="pencil" />
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label={`Unsubscribe from ${feed.title}`}
                      title="Unsubscribe"
                      onClick={() => {
                        if (window.confirm(`Unsubscribe from "${feed.title}"?`)) {
                          unsubscribe.mutate(feed.id);
                        }
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
              </section>
            );
          })}
        </div>

        <h3 className="subs-section">Import and export</h3>
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

        {status && <div className="subs-status">{status}</div>}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
