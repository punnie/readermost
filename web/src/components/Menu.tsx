import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  label: ReactNode;
  title?: string;
  children: (close: () => void) => ReactNode;
}

/**
 * A small dropdown. Closes on outside click, on Escape, and whenever an item
 * calls the close function it is handed.
 */
export function Menu({ label, title, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    // Capture, so Escape closes the menu before the app's global handler sees it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className="btn"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>

      {open && (
        <div className="menu-items" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface ItemProps {
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  checked?: boolean;
  children: ReactNode;
}

export function MenuItem({
  onClick,
  disabled,
  danger,
  title,
  checked,
  children,
}: ItemProps) {
  return (
    <button
      className={`menu-item ${danger ? "danger" : ""}`}
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="menu-check">{checked ? "✓" : ""}</span>
      <span>{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="menu-heading">{children}</div>;
}
