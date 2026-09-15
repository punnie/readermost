import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import type { Tree } from "../types";

interface Props {
  tree?: Tree;
  /** Prefilled feed URL, when subscribing from a shared item. */
  initialFeedUrl?: string;
  initialTitle?: string;
  onClose: () => void;
}

interface Candidate {
  title: string;
  url: string;
  type: string;
}

/**
 * Adding a subscription. Miniflux's own discovery turns a homepage URL into the
 * feeds it advertises, so pasting "example.com" works as well as a feed URL.
 */
export function AddSubscription({ tree, initialFeedUrl, initialTitle, onClose }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState(initialFeedUrl ?? "");
  const [candidates, setCandidates] = useState<Candidate[]>();
  const [categoryId, setCategoryId] = useState<number | undefined>(
    tree?.categories[0]?.id,
  );
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (categoryId === undefined && tree?.categories.length) {
      setCategoryId(tree.categories[0].id);
    }
  }, [tree, categoryId]);

  const discover = useMutation({
    mutationFn: (candidate: string) => api.discover(candidate),
    onSuccess: (found) => {
      setError(undefined);
      if (found.length === 0) {
        setError("No feeds found at that address.");
        return;
      }
      // A single hit is not worth a second click.
      if (found.length === 1) {
        subscribe.mutate(found[0].url);
        return;
      }
      setCandidates(found);
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "Discovery failed"),
  });

  const subscribe = useMutation({
    mutationFn: async (feedUrl: string) => {
      let target = categoryId;

      // Creating the folder inline saves a trip through a separate dialog.
      const wanted = newCategory.trim();
      if (wanted) {
        const created = await api.createCategory(wanted);
        target = created.id;
      }
      if (!target) {
        throw new Error("Pick a folder first.");
      }
      return api.createFeed(feedUrl, target);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tree"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      onClose();
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "Could not subscribe"),
  });

  const busy = discover.isPending || subscribe.isPending;

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true">
        <h3>{initialTitle ? `Subscribe to ${initialTitle}` : "Add subscription"}</h3>

        <input
          ref={inputRef}
          type="text"
          placeholder="https://example.com or a feed URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && url.trim()) discover.mutate(url.trim());
            if (event.key === "Escape") onClose();
          }}
        />

        {candidates && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Several feeds found — pick one:
            </div>
            {candidates.map((candidate) => (
              <button
                key={candidate.url}
                className="nav-item"
                disabled={busy}
                onClick={() => subscribe.mutate(candidate.url)}
              >
                <span className="label">{candidate.title || candidate.url}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: "14px" }}>
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Folder
          </label>
          <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
            <select
              value={newCategory ? "" : String(categoryId ?? "")}
              disabled={Boolean(newCategory)}
              onChange={(event) => setCategoryId(Number(event.target.value))}
              style={{ flex: 1, padding: "6px" }}
            >
              {tree?.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="or a new folder"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        </div>

        {error && (
          <div className="error-banner" style={{ marginTop: "10px" }}>
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !url.trim()}
            onClick={() => {
              const target = url.trim();
              // A feed URL handed to us from a share is already exact;
              // discovery would only be a wasted round trip.
              if (initialFeedUrl && target === initialFeedUrl) {
                subscribe.mutate(target);
              } else {
                discover.mutate(target);
              }
            }}
          >
            {busy ? "Working…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
