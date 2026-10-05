import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/**
 * Close on a click outside ref, and on Escape — captured, so Escape closes the
 * menu before the app's global handler sees it.
 */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, ref]);
}

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
  useDismiss(open, ref, () => setOpen(false));

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

interface ContextMenuProps {
  /** Where the pointer was, in viewport coordinates. */
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

/** A right-click menu, opened at the pointer and kept on screen. */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useDismiss(true, ref, onClose);

  // Pull in from the edges once the menu's size is known, before it paints.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="menu-items context-menu"
      role="menu"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
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
