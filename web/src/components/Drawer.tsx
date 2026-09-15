import { useEffect } from "react";

import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The sliding panel of sources. It wraps the existing Sidebar rather than
 * reimplementing it: collapsible folders, unread counts and favicons are
 * already there.
 */
export function Drawer({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`drawer-scrim ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-label="Sources"
        aria-hidden={!open}
      >
        {children}
      </div>
    </>
  );
}
