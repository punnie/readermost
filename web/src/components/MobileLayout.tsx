import type { ReactNode } from "react";

import { Drawer } from "./Drawer";

interface Props {
  topBar: ReactNode;
  /** The one pane a phone shows: a list, or an article. */
  children: ReactNode;
  tabBar: ReactNode;
  drawer: ReactNode;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  offline: boolean;
}

/**
 * The phone frame: a fixed bar, one scrolling pane, and the tab bar — with the
 * sources drawer over the top.
 *
 * Deliberately a shell that takes its contents as props rather than a component
 * that knows about feeds. Everything it shows is built where the data lives, so
 * the two layouts share components instead of duplicating them.
 */
export function MobileLayout({
  topBar,
  children,
  tabBar,
  drawer,
  drawerOpen,
  onCloseDrawer,
  offline,
}: Props) {
  return (
    <div className="mobile">
      {offline && (
        <div className="offline-banner">You're offline — showing saved articles.</div>
      )}
      {topBar}
      <main className="mobile-pane">{children}</main>
      {tabBar}

      <Drawer open={drawerOpen} onClose={onCloseDrawer}>
        {drawer}
      </Drawer>
    </div>
  );
}
