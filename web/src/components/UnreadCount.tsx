import { useUnreadMark } from "../hooks";

interface Props {
  count: number;
  /** For the number; the dot has its own look wherever it appears. */
  className?: string;
  /** Lets a cramped spot, like a tab badge, cap what it shows. */
  format?: (count: number) => string;
}

/**
 * How many unread items there are — or, for a reader who has asked not to be
 * told, only that there are some: a dot in the accent colour where the number
 * would have been. Nothing at all when there are none.
 */
export function UnreadCount({ count, className = "count", format = String }: Props) {
  const mark = useUnreadMark();

  if (count <= 0) return null;
  if (mark === "dot") return <span className="unread-dot" role="img" aria-label="Unread" />;
  return <span className={className}>{format(count)}</span>;
}
