import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { defaultMoveTarget, otherFolders } from "../folders";
import type { Tree } from "../types";

interface Props {
  tree?: Tree;
  categoryID: number;
  onClose: () => void;
  onDeleted?: (categoryID: number) => void;
}

/**
 * Delete a folder, choosing where its feeds go. Picking a folder to move them
 * into is also how two folders are merged.
 */
export function DeleteFolder({ tree, categoryID, onClose, onDeleted }: Props) {
  const queryClient = useQueryClient();
  const category = tree?.categories.find((candidate) => candidate.id === categoryID);
  const feedCount = category?.feeds.length ?? 0;
  const destinations = otherFolders(tree, categoryID).sort((a, b) =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
  );
  const [moveTo, setMoveTo] = useState(() => defaultMoveTarget(tree, categoryID)?.id);

  const remove = useMutation({
    mutationFn: () => api.deleteCategory(categoryID, feedCount ? moveTo : undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tree"] });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      onDeleted?.(categoryID);
      onClose();
    },
  });

  // Escape closes this dialog only, not the Subscriptions dialog beneath it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // The folder vanished underneath us — deleted in another tab, say.
  if (!category) return null;

  const stranded = feedCount > 0 && destinations.length === 0;

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true">
        <h3>Delete “{category.title}”?</h3>

        {feedCount === 0 && <p className="dialog-text">The folder is empty.</p>}

        {stranded && (
          <p className="dialog-text">
            This is your only folder, so its feeds would have nowhere to go. Create another
            folder first.
          </p>
        )}

        {feedCount > 0 && !stranded && (
          <label className="dialog-field">
            <span>
              Move its {feedCount} feed{feedCount === 1 ? "" : "s"} to
            </span>
            <select
              value={moveTo}
              onChange={(event) => setMoveTo(Number(event.target.value))}
              autoFocus
            >
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {remove.isError && (
          <div className="error-banner" style={{ marginTop: "8px" }}>
            {remove.error instanceof Error ? remove.error.message : "Could not delete it"}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || stranded}
          >
            {remove.isPending ? "Deleting…" : "Delete folder"}
          </button>
        </div>
      </div>
    </div>
  );
}
