import { useEffect } from "react";
import { Download, ListTree, LogOut, Palette, Plus, type LucideIcon } from "lucide-react";

interface Props {
  displayName?: string;
  onClose: () => void;
  onSubscribe: () => void;
  onSubscriptions: () => void;
  onReading: () => void;
  onSignOut: () => void;
}

/** What the desktop top bar holds, which has nowhere else to live on a phone. */
export function MoreSheet({
  displayName,
  onClose,
  onSubscribe,
  onSubscriptions,
  onReading,
  onSignOut,
}: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const item = (label: string, action: () => void, Icon: LucideIcon, danger = false) => (
    <button
      className={`sheet-item ${danger ? "danger" : ""}`}
      onClick={() => {
        action();
        onClose();
      }}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div
      className="sheet-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-label="More">
        <div className="sheet-handle" aria-hidden="true" />
        {displayName && <div className="sheet-account">Signed in as {displayName}</div>}

        {item("Subscribe to a feed", onSubscribe, Plus)}
        {item("Subscriptions", onSubscriptions, ListTree)}
        {item("Appearance", onReading, Palette)}
        {item("Export OPML", () => window.open("/api/export", "_blank"), Download)}
        {item("Sign out", onSignOut, LogOut, true)}
      </div>
    </div>
  );
}
