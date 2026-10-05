import { Ellipsis, Inbox, Newspaper, Star, Users, type LucideIcon } from "lucide-react";

import { UnreadCount } from "./UnreadCount";
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
  icon: LucideIcon;
}

/** The same icons as the desktop sidebar, so the two read as one app. */
const TABS: Tab[] = [
  { kind: "all", label: "All", icon: Newspaper },
  { kind: "unread", label: "Unread", icon: Inbox },
  { kind: "starred", label: "Starred", icon: Star },
  { kind: "shared", label: "Shared", icon: Users },
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
      {TABS.map(({ kind, label, icon: Icon }) => {
        const badge = badgeFor(kind);
        const active = !moreOpen && selection.kind === kind;

        return (
          <button
            key={kind}
            className={`tab ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect({ kind } as Selection)}
          >
            <span className="tab-glyph" aria-hidden="true">
              <Icon size={22} strokeWidth={active ? 2.25 : 1.75} />
              <UnreadCount
                count={badge}
                className="tab-badge"
                format={(count) => (count > 99 ? "99+" : String(count))}
              />
            </span>
            <span className="tab-label">{label}</span>
          </button>
        );
      })}

      <button className={`tab ${moreOpen ? "active" : ""}`} onClick={onMore}>
        <span className="tab-glyph" aria-hidden="true">
          <Ellipsis size={22} strokeWidth={moreOpen ? 2.25 : 1.75} />
        </span>
        <span className="tab-label">More</span>
      </button>
    </nav>
  );
}
