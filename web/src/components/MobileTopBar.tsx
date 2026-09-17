import type { ReactNode } from "react";

import { Icon } from "./Icon";

interface ListBarProps {
  title: string;
  onOpenDrawer: () => void;
  onSearch: () => void;
  menu: ReactNode;
}

/** The bar over a list: sources, what you are reading, and its options. */
export function MobileListBar({ title, onOpenDrawer, onSearch, menu }: ListBarProps) {
  return (
    <header className="mobile-bar">
      <button className="bar-btn" aria-label="Show sources" onClick={onOpenDrawer}>
        <span aria-hidden="true">☰</span>
      </button>
      <h1 className="bar-title">{title}</h1>
      <button className="bar-btn" aria-label="Search" onClick={onSearch}>
        <span aria-hidden="true">⌕</span>
      </button>
      {menu}
    </header>
  );
}

interface ArticleBarProps {
  subtitle: string;
  starred?: boolean;
  onBack: () => void;
  onStar?: () => void;
  onShare?: () => void;
  menu: ReactNode;
}

/** The bar over an article: back, the two actions worth a tap, and the rest. */
export function MobileArticleBar({
  subtitle,
  starred,
  onBack,
  onStar,
  onShare,
  menu,
}: ArticleBarProps) {
  return (
    <header className="mobile-bar">
      <button className="bar-btn" aria-label="Back to the list" onClick={onBack}>
        <span aria-hidden="true">‹</span>
      </button>
      <h1 className="bar-title">{subtitle}</h1>

      {onStar && (
        <button
          className={`bar-btn ${starred ? "starred" : ""}`}
          aria-label={starred ? "Remove star" : "Star this article"}
          onClick={onStar}
        >
          <span aria-hidden="true">{starred ? "★" : "☆"}</span>
        </button>
      )}
      {onShare && (
        <button className="bar-btn" aria-label="Share to Mattermost" onClick={onShare}>
          <Icon name="share" size={17} />
        </button>
      )}
      {menu}
    </header>
  );
}
