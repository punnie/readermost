import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";

interface Props {
  onClose: () => void;
}

/** Create a folder on its own, without having to be adding a feed. */
export function NewFolder({ onClose }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const create = useMutation({
    mutationFn: (name: string) => api.createCategory(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tree"] });
      onClose();
    },
  });

  const submit = () => {
    const name = title.trim();
    if (name) create.mutate(name);
  };

  return (
    <div
      className="backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true">
        <h3>New folder</h3>

        <input
          ref={inputRef}
          type="text"
          placeholder="Folder name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") onClose();
          }}
        />

        {create.isError && (
          <div className="error-banner" style={{ marginTop: "8px" }}>
            {create.error instanceof Error ? create.error.message : "Could not create it"}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={create.isPending || !title.trim()}
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
