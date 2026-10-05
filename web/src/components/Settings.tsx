import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Folder, GripVertical, Pencil, Trash2 } from "lucide-react";

import { api } from "../api";
import {
  feedDragProps,
  folderDropProps,
  useDragAutoScroll,
  useFeedDrag,
  useSpringLoadedFolders,
} from "../dnd";
import { useCollapsedFolders } from "../folders";
import { useMoveFeed } from "../hooks";
import { DropStrip } from "./DropStrip";
import { FeedIcon } from "./FeedIcon";
import type { Tree } from "../types";

interface Props {
  tree?: Tree;
  onClose: () => void;
  /** Ask to delete a folder; the app owns the dialog, so it can fix the selection. */
  onDeleteFolder: (categoryId: number) => void;
}

/** Subscription housekeeping: drag feeds between folders, rename, unsubscribe. */
export function Settings({ tree, onClose, onDeleteFolder }: Props) {
  const queryClient = useQueryClient();
  const moveFeed = useMoveFeed();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>();
  const [dropTarget, setDropTarget] = useState<number>();
  const listRef = useRef<HTMLDivElement>(null);
  const { collapsed, toggle, setAll } = useCollapsedFolders();

  const anyDrag = useFeedDrag();
  const drag = anyDrag?.origin === "subscriptions" ? anyDrag : undefined;
  useDragAutoScroll(listRef, drag !== undefined);
  const peeked = useSpringLoadedFolders(dropTarget, collapsed, drag !== undefined);
  const allIDs = tree?.categories.map((category) => category.id) ?? [];
  const allCollapsed = allIDs.length > 0 && allIDs.every((id) => collapsed.has(id));

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
            disabled={allIDs.length === 0}
            onClick={() => setAll(allIDs, !allCollapsed)}
            title="Collapsed folders still take a dropped feed"
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
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

        <p className="subs-hint">
          Drag a feed onto a folder to move it — every folder appears at the top while you drag.
        </p>

        <div className="subs-list" ref={listRef}>
          <DropStrip
            tree={tree}
            drag={drag}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onMove={moveFeed}
          />

          {tree?.categories.map((category) => {
            const isCollapsed = collapsed.has(category.id) && !peeked.has(category.id);

            return (
              <section
                key={category.id}
                className={`subs-folder ${isCollapsed ? "collapsed" : ""} ${
                  dropTarget === category.id ? "drop-target" : ""
                }`}
                // The heading and every feed row accept a drop, meaning this folder.
                {...folderDropProps(category.id, moveFeed, setDropTarget)}
              >
                <div className="subs-folder-head">
                  <button
                    className="twisty"
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${category.title}`}
                    title={isCollapsed ? "Expand" : "Collapse"}
                    onClick={() => toggle(category.id)}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={14} aria-hidden="true" />
                    )}
                  </button>
                  <Folder size={15} aria-hidden="true" />
                  <button className="name" onClick={() => toggle(category.id)}>
                    {category.title}
                  </button>
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
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-btn danger"
                    aria-label={`Delete the folder ${category.title}`}
                    title="Delete folder"
                    onClick={() => onDeleteFolder(category.id)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>

                {!isCollapsed && category.feeds.length === 0 && (
                  <div className="subs-empty">Empty — drop a feed here</div>
                )}

                {!isCollapsed && category.feeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="subs-feed"
                    {...feedDragProps(feed.id, category.id, "subscriptions")}
                  >
                    <span className="grip" title="Drag to another folder">
                      <GripVertical size={15} aria-hidden="true" />
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
                      <Pencil size={15} aria-hidden="true" />
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
                      <Trash2 size={15} aria-hidden="true" />
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
