import type { Selection } from "../types";

interface Props {
  selection: Selection;
  unread: number;
  riverUnread: number;
  onSelect: (selection: Selection) => void;
  onMore: () => void;
  moreOpen: boolean;
}

interface Tab {
  kind: Selection["kind"];
  label: string;
  glyph: string;
}

const TABS: Tab[] = [
  { kind: "all", label: "All", glyph: "≣" },
  { kind: "unread", label: "Unread", glyph: "●" },
  { kind: "starred", label: "Starred", glyph: "★" },
  { kind: "shared", label: "Shared", glyph: "◆" },
];

/** The phone's primary navigation. */
export function TabBar({
  selection,
  unread,
  riverUnread,
  onSelect,
  onMore,
  moreOpen,
}: Props) {
  const badgeFor = (kind: Selection["kind"]) => {
    if (kind === "unread") return unread;
    if (kind === "shared") return riverUnread;
    return 0;
  };

  return (
    <nav className="tabbar" aria-label="Views">
      {TABS.map((tab) => {
        const badge = badgeFor(tab.kind);
        const active = !moreOpen && selection.kind === tab.kind;

        return (
          <button
            key={tab.kind}
            className={`tab ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect({ kind: tab.kind } as Selection)}
          >
            <span className="tab-glyph" aria-hidden="true">
              {tab.glyph}
              {badge > 0 && <span className="tab-badge">{badge > 99 ? "99+" : badge}</span>}
            </span>
            <span className="tab-label">{tab.label}</span>
          </button>
        );
      })}

      <button className={`tab ${moreOpen ? "active" : ""}`} onClick={onMore}>
        <span className="tab-glyph" aria-hidden="true">
          ⋯
        </span>
        <span className="tab-label">More</span>
      </button>
    </nav>
  );
}
