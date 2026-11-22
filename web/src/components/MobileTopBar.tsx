import type { ReactNode } from "react";
import { ChevronLeft, Menu, Search } from "lucide-react";

interface ListBarProps {
  title: string;
  onOpenDrawer: () => void;
  onSearch: () => void;
  menu: ReactNode;
}

/** The bar over a list: sources, what you are reading, and its options. */
export function MobileListBar({
  title,
  onOpenDrawer,
  onSearch,
  menu,
}: ListBarProps) {
  return (
    <header className="mobile-bar">
      <button
        className="bar-btn"
        aria-label="Show sources"
        onClick={onOpenDrawer}
      >
        <Menu size={22} aria-hidden="true" />
      </button>
      <h1 className="bar-title">{title}</h1>
      <button className="bar-btn" aria-label="Search" onClick={onSearch}>
        <Search size={21} aria-hidden="true" />
      </button>
      {menu}
    </header>
  );
}

interface ArticleBarProps {
  subtitle: string;
  onBack: () => void;
  menu: ReactNode;
}

/**
 * The bar over an article: back, where it is from, and the menu. The actions
 * live in the reading bar at the bottom, where a thumb can reach them.
 */
export function MobileArticleBar({ subtitle, onBack, menu }: ArticleBarProps) {
  return (
    <header className="mobile-bar">
      <button
        className="bar-btn"
        aria-label="Back to the list"
        onClick={onBack}
      >
        <ChevronLeft size={26} aria-hidden="true" />
      </button>
      <h1 className="bar-title">{subtitle}</h1>
      {menu}
    </header>
  );
}
