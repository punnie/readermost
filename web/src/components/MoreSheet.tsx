import { useEffect } from "react";

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

  const item = (label: string, action: () => void, danger = false) => (
    <button
      className={`sheet-item ${danger ? "danger" : ""}`}
      onClick={() => {
        action();
        onClose();
      }}
    >
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

        {item("Subscribe to a feed", onSubscribe)}
        {item("Subscriptions", onSubscriptions)}
        {item("Reading: font and size", onReading)}
        {item("Export OPML", () => window.open("/api/export", "_blank"))}
        {item("Sign out", onSignOut, true)}
      </div>
    </div>
  );
}
