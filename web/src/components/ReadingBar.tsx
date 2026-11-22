import { ChevronDown, ChevronUp, Mail, MailOpen, Share, Star } from "lucide-react";

interface Props {
  /** Absent at the ends of the list. The rest are absent when they do not apply. */
  onPrevious?: () => void;
  onNext?: () => void;
  starred?: boolean;
  onStar?: () => void;
  onShare?: () => void;
  /** Whether the open article counts as read, for the read toggle. */
  read?: boolean;
  onToggleRead?: () => void;
  /** How far through the article, 0–1, drawn along the top edge. */
  progress: number;
  /** Tucked away while scrolling down; any upward nudge brings it back. */
  hidden: boolean;
}

/**
 * The phone's bottom bar while reading: everything you might want to do with
 * an article, in thumb reach, without first scrolling to its end. It takes the
 * tab bar's place — the tabs are one Back away, on the list.
 */
export function ReadingBar({
  onPrevious,
  onNext,
  starred,
  onStar,
  onShare,
  read,
  onToggleRead,
  progress,
  hidden,
}: Props) {
  return (
    <nav className={`reading-bar ${hidden ? "hidden" : ""}`} aria-label="Article">
      <div
        className="reading-progress"
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }}
        aria-hidden="true"
      />

      <button
        className="bar-btn"
        aria-label="Previous article"
        disabled={!onPrevious}
        onClick={onPrevious}
      >
        <ChevronUp size={24} aria-hidden="true" />
      </button>

      {/* Shared river items have no star or read state of their own here. */}
      {onStar && (
        <button
          className={`bar-btn ${starred ? "starred" : ""}`}
          aria-label={starred ? "Remove star" : "Star this article"}
          aria-pressed={starred}
          onClick={onStar}
        >
          <Star size={21} fill={starred ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      )}

      {onShare && (
        <button className="bar-btn" aria-label="Share" onClick={onShare}>
          <Share size={20} aria-hidden="true" />
        </button>
      )}

      {onToggleRead && (
        <button
          className="bar-btn"
          aria-label={read ? "Mark unread" : "Mark read"}
          onClick={onToggleRead}
        >
          {read ? <Mail size={21} aria-hidden="true" /> : <MailOpen size={21} aria-hidden="true" />}
        </button>
      )}

      <button
        className="bar-btn"
        aria-label="Next article"
        disabled={!onNext}
        onClick={onNext}
      >
        <ChevronDown size={24} aria-hidden="true" />
      </button>
    </nav>
  );
}
