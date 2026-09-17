import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";

import { ApiError, api } from "./api";
import {
  useEntries,
  useKeyboard,
  useMe,
  useReadBatcher,
  useSetStatus,
  useDebounced,
  useMoveFeed,
  useRefreshFeeds,
  unreadForSelection,
  useToggleStar,
  useTree,
} from "./hooks";
import { EntryList } from "./components/EntryList";
import { EntryView } from "./components/EntryView";
import { SharedList } from "./components/SharedList";
import { SharedArticle } from "./components/SharedArticle";
import { ShareDialog } from "./components/ShareDialog";
import { Shortcuts } from "./components/Shortcuts";
import { Sidebar } from "./components/Sidebar";
import { Welcome } from "./components/Welcome";
import { AddSubscription } from "./components/AddSubscription";
import { Settings } from "./components/Settings";
import { NewFolder } from "./components/NewFolder";
import { ListToolbar } from "./components/ListToolbar";
import { SearchView } from "./components/SearchView";
import { ListMenu } from "./components/ListMenu";
import { MenuItem, MenuSeparator } from "./components/Menu";
import { MobileLayout } from "./components/MobileLayout";
import { MobileArticleBar, MobileListBar } from "./components/MobileTopBar";
import { MoreSheet } from "./components/MoreSheet";
import { TabBar } from "./components/TabBar";
import { useIsMobile } from "./useIsMobile";
import { useViewportHeight } from "./useViewportHeight";
import { useSwipeNavigation } from "./swipe";
import { useLiveUpdates } from "./useLiveUpdates";
import { useOnline } from "./offline";
import { clearPersistedCache } from "./persist";
import { pathFor, pathForSearch, routeFrom, sameSelection } from "./routes";
import { readSort, shuffle, writeSort, type SortOrder } from "./sort";
import {
  matchesLength,
  readLengthFilter,
  readStatusFilter,
  writeLengthFilter,
  writeStatusFilter,
  type LengthFilter,
  type StatusFilter,
} from "./filters";
import type { Entry, Selection, SharedRiver, Tree } from "./types";

function SignIn() {
  return (
    <div className="centered">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Readermost</h2>
        <p style={{ color: "var(--text-muted)" }}>
          A shared reader for your Mattermost crowd.
        </p>
        <a className="btn btn-primary" href="/auth/login">
          Sign in with Mattermost
        </a>
      </div>
    </div>
  );
}

/**
 * A selection's name. Feeds and folders are addressed by id, so the name lives
 * in the tree — and is briefly unknown on a cold load from a deep link.
 */
function selectionTitle(selection: Selection, tree?: Tree): string {
  switch (selection.kind) {
    case "all":
      return "All items";
    case "unread":
      return "Unread";
    case "starred":
      return "Starred";
    case "shared":
      return "Shared by friends";
    case "category":
      return tree?.categories.find((category) => category.id === selection.id)?.title ?? "Folder";
    case "feed":
      return (
        tree?.categories
          .flatMap((category) => category.feeds)
          .find((feed) => feed.id === selection.id)?.title ?? "Feed"
      );
  }
}

export function App() {
  const queryClient = useQueryClient();
  const me = useMe();
  const tree = useTree();

  const [location, navigate] = useLocation();
  const queryString = useSearch();
  const route = useMemo(() => routeFrom(location, queryString), [location, queryString]);
  const selection = route.selection;
  const selectedEntryId = route.entryID;

  /** Change what is showing by changing the address. */
  const setSelection = useCallback(
    (next: Selection) => navigate(pathFor(next)),
    [navigate],
  );

  /**
   * Open an article.
   *
   * Pushes the first time — opening one from the list — and replaces when
   * moving between articles. That single rule serves both layouts: a burst of
   * j does not bury the feed in history, and on a phone the back button
   * returns to the list rather than leaving the app.
   */
  const setSelectedEntryId = useCallback(
    (entryID: number | undefined) =>
      navigate(pathFor(selection, entryID), { replace: selectedEntryId !== undefined }),
    [navigate, selection, selectedEntryId],
  );
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [sharing, setSharing] = useState<Entry>();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // Set when subscribing from a shared item, to prefill the folder picker.
  const [subscribeTo, setSubscribeTo] = useState<{ feedUrl: string; feedTitle: string }>();
  const [showSettings, setShowSettings] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  // The open shared post is addressable too — and unlike feed ids, Mattermost
  // post ids are global, so this one URL really is shareable with a friend.
  const selectedSharedPost = route.postID;
  const setSelectedSharedPost = useCallback(
    (postID: string) =>
      // Same rule as articles: push into the river, replace while moving in it.
      navigate(pathFor({ kind: "shared" }, postID), { replace: route.postID !== undefined }),
    [navigate, route.postID],
  );
  // Set after sharing, to scroll the article's discussion into view and focus it.
  const [focusDiscussion, setFocusDiscussion] = useState(0);
  const [sort, setSort] = useState<SortOrder>(() => readSort({ kind: "unread" }));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    readStatusFilter({ kind: "unread" }),
  );
  const [lengthFilter, setLengthFilter] = useState<LengthFilter>(() =>
    readLengthFilter({ kind: "unread" }),
  );

  const moveFeed = useMoveFeed();
  const { refresh, refreshingWhat } = useRefreshFeeds();
  const online = useOnline();
  const isMobile = useIsMobile();
  useViewportHeight();

  /** On a phone the URL decides the screen: an open item means the article. */
  const showingArticle =
    selection.kind === "shared" ? Boolean(route.postID) : selectedEntryId !== undefined;

  const articleRef = useRef<HTMLDivElement>(null);
  const restoring = useIsRestoring();

  // Live shared-channel updates, once we know who we are.
  useLiveUpdates(Boolean(me.data));

  // The shared river is a list like any other, so App owns it and the two panes
  // read from the same data.
  const shared = useQuery({
    queryKey: ["shared"],
    queryFn: () => api.shared(),
    // Always loaded, not just in the shared view: the sidebar badge needs it.
  });
  const sharedItems = useMemo(() => shared.data?.items ?? [], [shared.data]);
  // Falling back to the newest item is right for /shared, but not when a
  // specific post was requested: showing a different article is worse than
  // showing none.
  const selectedSharedItem = selectedSharedPost
    ? sharedItems.find((item) => item.post_id === selectedSharedPost)
    : sharedItems[0];

  // Search lives in the query string, so the route is the source of truth for
  // it too. The typed value is debounced before it becomes a request.
  const searchRoute = route.search;
  const [pendingQuery, setPendingQuery] = useState(searchRoute?.query ?? "");
  const [searchScopeCandidate, setSearchScopeCandidate] = useState<Selection>();

  useEffect(() => {
    setPendingQuery(searchRoute?.query ?? "");
  }, [searchRoute?.query]);

  const debouncedQuery = useDebounced(pendingQuery, 300);

  // Keep the address in step with the settled query, replacing rather than
  // pushing so typing does not fill the history with every keystroke.
  useEffect(() => {
    if (!searchRoute) return;
    if (debouncedQuery === searchRoute.query) return;
    navigate(pathForSearch(debouncedQuery, searchRoute.scope), { replace: true });
  }, [debouncedQuery, searchRoute, navigate]);

  const searchEntries = useQuery({
    queryKey: ["search-entries", debouncedQuery, searchRoute?.scope],
    queryFn: () =>
      api.entries({
        search: debouncedQuery,
        limit: 50,
        status: ["unread", "read"],
        feedId: searchRoute?.scope?.kind === "feed" ? searchRoute.scope.id : undefined,
        categoryId:
          searchRoute?.scope?.kind === "category" ? searchRoute.scope.id : undefined,
      }),
    enabled: Boolean(searchRoute) && debouncedQuery.trim().length > 1,
  });

  /** Results behave as a list, so j/k and swipe traverse them like any other. */
  const searchResults = searchEntries.data?.entries ?? [];

  const openSearchEntry = useCallback(
    (entry: Entry) => {
      if (!searchRoute) return;
      navigate(pathForSearch(searchRoute.query, searchRoute.scope, entry.id), {
        replace: selectedEntryId !== undefined,
      });
    },
    [navigate, searchRoute, selectedEntryId],
  );

  const entries = useEntries(selection, sort, statusFilter, lengthFilter);
  const setStatus = useSetStatus(selection, sort, statusFilter, lengthFilter);
  const toggleStar = useToggleStar(selection, sort, statusFilter, lengthFilter);

  const unreadForCurrent = useMemo(
    () => unreadForSelection(tree.data, selection) ?? 0,
    [tree.data, selection],
  );

  const list = useMemo(() => {
    const all = entries.data?.entries ?? [];
    // Miniflux has no reading-time filter, so this pass is ours.
    const fetched =
      lengthFilter === "any" ? all : all.filter((entry) => matchesLength(entry, lengthFilter));
    if (sort !== "magic") return fetched;
    // Seeded on the selection so the order survives re-renders, and changes
    // when you move to a different feed.
    const seed = JSON.stringify(selection).length * 2654435761;
    return shuffle(fetched, seed);
  }, [entries.data, sort, selection, lengthFilter]);
  // In search mode the open article comes from the results, not from the
  // selection's own list — looking it up in the wrong one left the reader pane
  // empty when a result was clicked.
  const entryInList = (searchRoute ? searchResults : list).find(
    (entry) => entry.id === selectedEntryId,
  );

  /**
   * The open article, when it is not in the list on screen.
   *
   * The URL addresses an article, so the app has to be able to show it whatever
   * the list happens to contain. Reading one in a feed filtered to unread takes
   * it out of that list the moment it is marked read, and without this the
   * back button, a reload, or a bookmarked link all landed on an empty pane.
   */
  const detachedEntry = useQuery({
    queryKey: ["entry", selectedEntryId],
    queryFn: () => api.entry(selectedEntryId!),
    enabled: selectedEntryId !== undefined && !entryInList,
    staleTime: 60_000,
  });

  const selectedEntry = entryInList ?? detachedEntry.data;

  // Does the selected article already have a discussion? Owned here rather than
  // in EntryView so the S shortcut and the button agree on the answer.
  const discussion = useQuery({
    queryKey: ["share-lookup", selectedEntry?.url],
    queryFn: () => api.lookupShare(selectedEntry!.url),
    enabled: Boolean(selectedEntry?.url),
    staleTime: 15_000,
  });

  /**
   * Select a river item and mark it read.
   *
   * The cache is written before the request goes out, mirroring openEntry —
   * that is what keeps j/k through the river feeling immediate.
   */
  const markSharedRead = useCallback(
    (postID: string) => {
      const current = queryClient.getQueryData<SharedRiver>(["shared"]);
      const item = current?.items.find((candidate) => candidate.post_id === postID);
      if (!item || (item.read && item.unseen_replies === 0)) return;

      queryClient.setQueryData<SharedRiver>(["shared"], (old) =>
        old
          ? {
              ...old,
              unread: item.read ? old.unread : Math.max(0, old.unread - 1),
              items: old.items.map((candidate) =>
                candidate.post_id === postID
                  ? { ...candidate, read: true, unseen_replies: 0 }
                  : candidate,
              ),
            }
          : old,
      );
      void api.markRiverRead(postID);
    },
    [queryClient],
  );

  const openShared = useCallback(
    (postID: string) => {
      setSelectedSharedPost(postID);
      markSharedRead(postID);
    },
    [setSelectedSharedPost, markSharedRead],
  );


  const refreshTree = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
    void queryClient.invalidateQueries({ queryKey: ["entries"] });
  }, [queryClient]);

  const markAllRead = useCallback(() => {
    if (selection.kind === "shared") {
      void api.markRiverReadAll().then(() => {
        void queryClient.invalidateQueries({ queryKey: ["shared"] });
      });
      return;
    }

    const scope =
      selection.kind === "category"
        ? { scope: "category" as const, id: selection.id }
        : selection.kind === "feed"
          ? { scope: "feed" as const, id: selection.id }
          : { scope: "all" as const, id: undefined };

    void api.markRead(scope.scope, scope.id).then(refreshTree);
  }, [selection, queryClient, refreshTree]);

  const refreshSelection = useCallback(() => {
    void refresh(selection);
  }, [refresh, selection]);

  /** Is a refresh running for the thing this control acts on? */
  const refreshingSelection =
    refreshingWhat !== undefined && sameSelection(refreshingWhat, selection);
  /** The whole-account Refresh only claims to be busy when it is the one running. */
  const refreshingEverything =
    refreshingWhat !== undefined && !("id" in refreshingWhat);

  const unsubscribe = useCallback(
    (feedId: number, title: string) => {
      if (!window.confirm(`Unsubscribe from "${title}"?`)) return;
      void api.deleteFeed(feedId).then(() => {
        setSelection({ kind: "unread" });
        refreshTree();
      });
    },
    [refreshTree],
  );

  const renameFolder = useCallback(
    (categoryId: number, current: string) => {
      const title = window.prompt("Rename folder", current);
      if (!title?.trim()) return;
      void api.updateCategory(categoryId, title.trim()).then(refreshTree);
    },
    [refreshTree],
  );

  const deleteFolder = useCallback(
    (categoryId: number, title: string) => {
      const target = (tree.data?.categories ?? [])
        .filter((category) => category.id !== categoryId)
        .sort((a, b) => a.id - b.id)[0];
      if (!target) return;

      const feedCount =
        tree.data?.categories.find((category) => category.id === categoryId)?.feeds.length ?? 0;

      const message = feedCount
        ? `Delete the folder "${title}"? Its ${feedCount} feed${feedCount === 1 ? "" : "s"} will move to "${target.title}".`
        : `Delete the empty folder "${title}"?`;
      if (!window.confirm(message)) return;

      void api.deleteCategory(categoryId).then(() => {
        setSelection({ kind: "unread" });
        refreshTree();
      });
    },
    [tree.data, refreshTree],
  );

  /**
   * The global search: always everywhere, whatever is on screen.
   *
   * Narrowing is a separate, deliberate act — "Search here" in a feed's menu —
   * because a button in the global bar that quietly searched inside the current
   * feed was indistinguishable from one that was broken.
   */
  const openSearch = useCallback(() => {
    setSearchScopeCandidate(undefined);
    navigate(pathForSearch(""));
  }, [navigate]);

  /** Search within one feed or folder, from its own menu. */
  const searchHere = useCallback(
    (scope: Selection) => {
      setSearchScopeCandidate(scope);
      navigate(pathForSearch("", scope));
    },
    [navigate],
  );

  const openDiscussion = useCallback(
    (postId: string) => {
      // One navigation, so the back button returns to the article rather than
      // to the river with nothing open.
      navigate(pathFor({ kind: "shared" }, postId));
      markSharedRead(postId);
    },
    [navigate, markSharedRead],
  );

  // Marking read is batched: flicking through with j should cost one request,
  // not one per article.
  const queueRead = useReadBatcher(
    useCallback(
      (ids: number[]) => setStatus.mutate({ ids, status: "read" }),
      [setStatus],
    ),
  );

  const openEntry = useCallback(
    (entry: Entry) => {
      setSelectedEntryId(entry.id);
      if (entry.status !== "unread") return;

      // Grey the row out now; the batched PUT follows within a second. Writing
      // the cache directly rather than firing a mutation is what keeps j/k
      // feeling instant without one request per keystroke.
      queryClient.setQueryData(
        ["entries", selection, sort, statusFilter, lengthFilter],
        (old: { entries: Entry[]; total: number } | undefined) =>
          old
            ? {
                ...old,
                entries: old.entries.map((candidate) =>
                  candidate.id === entry.id
                    ? { ...candidate, status: "read" as const }
                    : candidate,
                ),
              }
            : old,
      );
      queueRead(entry.id);
    },
    [queueRead, queryClient, selection, sort, statusFilter, lengthFilter],
  );

  // Changing folders should land on nothing selected rather than a stale entry.
  // Moving to a different feed loads that feed's remembered preferences. The
  // route object is rebuilt on every navigation, so compare by value.
  const previousSelection = useRef(selection);
  useEffect(() => {
    if (sameSelection(previousSelection.current, selection)) return;
    previousSelection.current = selection;
    setSort(readSort(selection));
    setStatusFilter(readStatusFilter(selection));
    setLengthFilter(readLengthFilter(selection));
  }, [selection]);

  const changeSort = useCallback(
    (order: SortOrder) => {
      setSort(order);
      writeSort(selection, order);
    },
    [selection],
  );

  const changeStatusFilter = useCallback(
    (filter: StatusFilter) => {
      setStatusFilter(filter);
      writeStatusFilter(selection, filter);
    },
    [selection],
  );

  const changeLengthFilter = useCallback(
    (filter: LengthFilter) => {
      setLengthFilter(filter);
      writeLengthFilter(selection, filter);
    },
    [selection],
  );

  const move = useCallback(
    (delta: number) => {
      if (searchRoute) {
        if (searchResults.length === 0) return;
        const current = searchResults.findIndex((entry) => entry.id === selectedEntryId);
        const next =
          current === -1 ? 0 : Math.min(Math.max(current + delta, 0), searchResults.length - 1);
        const entry = searchResults[next];
        if (entry) openSearchEntry(entry);
        return;
      }

      // The shared view is a list like any other, so j/k walks it the same way.
      if (selection.kind === "shared") {
        if (sharedItems.length === 0) return;
        const current = sharedItems.findIndex(
          (item) => item.post_id === selectedSharedItem?.post_id,
        );
        const next =
          current === -1 ? 0 : Math.min(Math.max(current + delta, 0), sharedItems.length - 1);
        const item = sharedItems[next];
        if (item) openShared(item.post_id);
        return;
      }

      if (list.length === 0) return;
      const current = list.findIndex((entry) => entry.id === selectedEntryId);
      const next = current === -1 ? 0 : Math.min(Math.max(current + delta, 0), list.length - 1);
      const entry = list[next];
      if (entry) openEntry(entry);
    },
    [
      searchRoute,
      searchResults,
      openSearchEntry,
      selection.kind,
      sharedItems,
      selectedSharedItem,
      openShared,
      list,
      selectedEntryId,
      openEntry,
    ],
  );

  /** The link the keyboard should open, whichever view is active. */
  const currentURL =
    selection.kind === "shared" ? selectedSharedItem?.link?.url : selectedEntry?.url;

  // The same traversal the keyboard uses, driven by a finger.
  useSwipeNavigation(articleRef, {
    onPrevious: () => move(-1),
    onNext: () => move(1),
    enabled: isMobile && showingArticle,
  });

  // `g` is a prefix: g then u/a/s jumps between views.
  const pendingGoto = useRef(false);

  useKeyboard({
    j: () => move(1),
    k: () => move(-1),
    o: () => currentURL && window.open(currentURL, "_blank", "noopener"),
    Enter: () => currentURL && window.open(currentURL, "_blank", "noopener"),
    v: () => currentURL && window.open(currentURL, "_blank", "noopener"),
    s: () => selectedEntry && toggleStar.mutate(selectedEntry.id),
    S: () => {
      if (!selectedEntry) return;
      // Same rule as the button: never create a second copy of a discussion.
      if (discussion.data?.shared && discussion.data.post_id) {
        openDiscussion(discussion.data.post_id);
        return;
      }
      setSharing(selectedEntry);
    },
    m: () =>
      selectedEntry &&
      setStatus.mutate({
        ids: [selectedEntry.id],
        status: selectedEntry.status === "read" ? "unread" : "read",
      }),
    r: () => refreshSelection(),
    A: () => {
      if (selection.kind === "shared") {
        void api.markRiverReadAll().then(() => {
          void queryClient.invalidateQueries({ queryKey: ["shared"] });
        });
        return;
      }

      const scope =
        selection.kind === "category"
          ? { scope: "category" as const, id: selection.id }
          : selection.kind === "feed"
            ? { scope: "feed" as const, id: selection.id }
            : { scope: "all" as const, id: undefined };

      void api.markRead(scope.scope, scope.id).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["tree"] });
        void queryClient.invalidateQueries({ queryKey: ["entries"] });
      });
    },
    g: () => {
      pendingGoto.current = true;
      window.setTimeout(() => {
        pendingGoto.current = false;
      }, 1200);
    },
    u: () => {
      if (pendingGoto.current) setSelection({ kind: "unread" });
      pendingGoto.current = false;
    },
    a: () => {
      if (pendingGoto.current) setSelection({ kind: "all" });
      pendingGoto.current = false;
    },
    "/": () => openSearch(),
    "?": () => setShowShortcuts(true),
    Escape: () => {
      setShowShortcuts(false);
      setSharing(undefined);
      setShowAdd(false);
      setShowSettings(false);
    },
  });

  if (restoring || (me.isLoading && !me.data)) {
    return <div className="centered">Loading…</div>;
  }
  // A failed refetch with a restored session is an offline session, not an
  // expired one — only a real 401 means sign in again.
  if (me.isError && !me.data) {
    const unauthorized = me.error instanceof ApiError && me.error.isUnauthorized;
    return unauthorized ? (
      <SignIn />
    ) : (
      <div className="centered">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Readermost</h2>
          <p style={{ color: "var(--text-muted)" }}>
            Can't reach the server, and there's nothing saved on this device yet.
          </p>
        </div>
      </div>
    );
  }
  if (me.data && !me.data.onboarded && !onboarded) {
    return (
      <Welcome
        onDone={() => {
          setOnboarded(true);
          void queryClient.invalidateQueries({ queryKey: ["tree"] });
          void queryClient.invalidateQueries({ queryKey: ["me"] });
        }}
      />
    );
  }

  /**
   * The phone's options menu: the same body as the desktop toolbar, plus the
   * actions that live as buttons there and have no room here.
   */
  const mobileMenu = (
    <ListMenu
      selection={selection}
      title={selectionTitle(selection, tree.data)}
      tree={tree.data}
      sort={sort}
      onSort={changeSort}
      statusFilter={statusFilter}
      onStatusFilter={changeStatusFilter}
      lengthFilter={lengthFilter}
      onLengthFilter={changeLengthFilter}
      onMoveFeed={moveFeed}
      onUnsubscribe={unsubscribe}
      onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder}
      onSearchHere={searchHere}
      extra={(close) => (
        <>
          {showingArticle && selectedEntry && (
            <>
              <MenuItem
                onClick={() => {
                  setStatus.mutate({
                    ids: [selectedEntry.id],
                    status: selectedEntry.status === "read" ? "unread" : "read",
                  });
                  close();
                }}
              >
                Mark {selectedEntry.status === "read" ? "unread" : "read"}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  window.open(selectedEntry.url, "_blank", "noopener");
                  close();
                }}
              >
                Open original
              </MenuItem>
              <MenuSeparator />
            </>
          )}

          <MenuItem
            disabled={!online}
            onClick={() => {
              markAllRead();
              close();
            }}
          >
            Mark all read
          </MenuItem>
          {selection.kind !== "shared" && (
            <MenuItem
              disabled={!online || refreshingSelection}
              onClick={() => {
                refreshSelection();
                close();
              }}
            >
              {refreshingSelection ? "Refreshing…" : "Refresh"}
            </MenuItem>
          )}
          <MenuSeparator />
        </>
      )}
    />
  );

  const mobileDialogs = (
    <>
      {sharing && (
        <ShareDialog
          entry={sharing}
          onCancel={() => setSharing(undefined)}
          onShare={async (message) => {
            await api.share(sharing.id, message);
            setSharing(undefined);
            void queryClient.invalidateQueries({ queryKey: ["shared"] });
            void queryClient.invalidateQueries({ queryKey: ["share-lookup"] });
            setFocusDiscussion((count) => count + 1);
          }}
        />
      )}

      {showAdd && <AddSubscription tree={tree.data} onClose={() => setShowAdd(false)} />}

      {subscribeTo && (
        <AddSubscription
          tree={tree.data}
          initialFeedUrl={subscribeTo.feedUrl}
          initialTitle={subscribeTo.feedTitle}
          onClose={() => setSubscribeTo(undefined)}
        />
      )}

      {showSettings && <Settings tree={tree.data} onClose={() => setShowSettings(false)} />}
      {showNewFolder && <NewFolder onClose={() => setShowNewFolder(false)} />}
      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
    </>
  );

  const searchPane = searchRoute ? (
    <SearchView
      query={pendingQuery}
      scope={searchRoute.scope}
      scopeCandidate={(() => {
        // Reloading /search?in=feed:12 should still show the chip.
        const candidate = searchScopeCandidate ?? searchRoute?.scope;
        return candidate
          ? { selection: candidate, title: selectionTitle(candidate, tree.data) }
          : undefined;
      })()}
      tree={tree.data}
      entries={searchResults}
      entriesLoading={searchEntries.isFetching}
      selectedEntryId={selectedEntryId}
      onQueryChange={setPendingQuery}
      onScopeChange={(next) =>
        navigate(pathForSearch(searchRoute.query, next), { replace: true })
      }
      onOpenEntry={openSearchEntry}
      onOpenFeed={(next) => navigate(pathFor(next))}
      onOpenShared={(postId) => navigate(pathFor({ kind: "shared" }, postId))}
    />
  ) : null;

  const listPane =
    selection.kind === "shared" ? (
      <SharedList
        items={sharedItems}
        selectedId={selectedSharedItem?.post_id}
        onSelect={(item) => openShared(item.post_id)}
        isLoading={shared.isLoading}
      />
    ) : (
      <EntryList
        entries={list}
        selectedId={selectedEntryId}
        onSelect={openEntry}
        isLoading={entries.isLoading}
        title={selectionTitle(selection, tree.data)}
      />
    );

  const articlePane =
    selection.kind === "shared" ? (
      <SharedArticle
        item={selectedSharedItem}
        tree={tree.data}
        onSubscribe={(feedUrl, feedTitle) => setSubscribeTo({ feedUrl, feedTitle })}
      />
    ) : (
      <EntryView
        entry={selectedEntry}
        onToggleStar={(id) => toggleStar.mutate(id)}
        onToggleRead={(entry) =>
          setStatus.mutate({
            ids: [entry.id],
            status: entry.status === "read" ? "unread" : "read",
          })
        }
        discussion={discussion.data}
        discussionLoading={discussion.isLoading}
        focusDiscussion={focusDiscussion}
        onShare={setSharing}
        onDiscuss={openDiscussion}
      />
    );

  const signOut = () => {
    void api
      .logout()
      .catch(() => {})
      // Clear before reloading: the cache outlives the session cookie, and the
      // next person on this browser must not inherit it.
      .finally(async () => {
        queryClient.clear();
        await clearPersistedCache();
        window.location.href = "/";
      });
  };

  if (isMobile) {
    return (
      <>
        <MobileLayout
          offline={!online}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          drawer={
            <Sidebar
              tree={tree.data}
              riverUnread={shared.data?.unread ?? 0}
              selection={selection}
              draggable={false}
              onSelect={(next) => {
                setSelection(next);
                setDrawerOpen(false);
              }}
              onNewFolder={() => {
                setShowNewFolder(true);
                setDrawerOpen(false);
              }}
              onMoveFeed={moveFeed}
              collapsed={collapsed}
              onToggleCollapse={(id) =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
          }
          topBar={
            showingArticle ? (
              <MobileArticleBar
                subtitle={
                  selection.kind === "shared"
                    ? (selectedSharedItem?.link?.feed_title ?? "Shared")
                    : (selectedEntry?.feed?.title ?? selectionTitle(selection, tree.data))
                }
                starred={selectedEntry?.starred}
                onBack={() => window.history.back()}
                onStar={selectedEntry ? () => toggleStar.mutate(selectedEntry.id) : undefined}
                onShare={selectedEntry ? () => setSharing(selectedEntry) : undefined}
                menu={mobileMenu}
              />
            ) : (
              <MobileListBar
                title={searchRoute ? "Search" : selectionTitle(selection, tree.data)}
                onOpenDrawer={() => setDrawerOpen(true)}
                onSearch={openSearch}
                menu={mobileMenu}
              />
            )
          }
          tabBar={
            <TabBar
              selection={selection}
              unread={tree.data?.total_unread ?? 0}
              riverUnread={shared.data?.unread ?? 0}
              moreOpen={moreOpen}
              onSelect={(next) => {
                setSelection(next);
                setMoreOpen(false);
              }}
              onMore={() => setMoreOpen((open) => !open)}
            />
          }
        >
          <div className="mobile-scroller">
            {/*
              The gesture surface is inside the scroller, never the scroller
              itself: transforming a scrolling container is what made iOS
              wobble sideways under a thumb.
            */}
            <div className="swipe-surface" ref={articleRef}>
              {searchRoute && !showingArticle
                ? searchPane
                : showingArticle
                  ? articlePane
                  : listPane}
            </div>
          </div>
        </MobileLayout>

        {moreOpen && (
          <MoreSheet
            displayName={me.data?.display_name}
            onClose={() => setMoreOpen(false)}
            onSubscribe={() => setShowAdd(true)}
            onSubscriptions={() => setShowSettings(true)}
            onSignOut={signOut}
          />
        )}

        {mobileDialogs}
      </>
    );
  }

  return (
    <div className="app">
      {!online && (
        <div className="offline-banner">
          You're offline — showing saved articles. Changes are paused.
        </div>
      )}

      <header className="topbar">
        <h1>Readermost</h1>
        <button
          className="btn"
          onClick={() => void refresh({ kind: "all" })}
          disabled={refreshingEverything || !online}
        >
          {refreshingEverything ? "Refreshing…" : "Refresh"}
        </button>
        <button className="btn" onClick={openSearch} title="Search (/)">
          ⌕ Search
        </button>
        <button className="btn" onClick={() => setShowAdd(true)}>
          + Subscribe
        </button>
        <button className="btn" onClick={() => setShowSettings(true)}>
          Subscriptions
        </button>
        <span className="spacer" />
        <button className="btn-link" onClick={() => setShowShortcuts(true)}>
          Shortcuts
        </button>
        <span className="who">{me.data?.display_name}</span>
        <button
          className="btn"
          onClick={() => {
            void api
              .logout()
              .catch(() => {})
              // Clear before reloading: the cache outlives the session cookie,
              // and the next person on this browser must not inherit it.
              .finally(async () => {
                queryClient.clear();
                await clearPersistedCache();
                window.location.href = "/";
              });
          }}
        >
          Sign out
        </button>
      </header>

      <Sidebar
        tree={tree.data}
        selection={selection}
        riverUnread={shared.data?.unread ?? 0}
        onSelect={setSelection}
        collapsed={collapsed}
        onNewFolder={() => setShowNewFolder(true)}
        onMoveFeed={moveFeed}
        onToggleCollapse={(id) =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            return next;
          })
        }
      />

      {/*
        The middle column is the toolbar stacked on its list, so the toolbar
        scrolls with neither — it stays pinned while the list moves under it.
      */}
      <div className="list-column">
        {searchRoute ? null : (
        <ListToolbar
          selection={selection}
          title={selectionTitle(selection, tree.data)}
          unread={
            selection.kind === "shared"
              ? (shared.data?.unread ?? 0)
              : unreadForCurrent
          }
          tree={tree.data}
          sort={sort}
          onSort={changeSort}
          statusFilter={statusFilter}
          onStatusFilter={changeStatusFilter}
          lengthFilter={lengthFilter}
          onLengthFilter={changeLengthFilter}
          online={online}
      isRefreshing={refreshingSelection}
          filteredOut={(entries.data?.entries.length ?? 0) - list.length}
          onMarkAllRead={markAllRead}
          onRefresh={refreshSelection}
          onMoveFeed={moveFeed}
          onUnsubscribe={unsubscribe}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onSearchHere={searchHere}
        />
        )}

        {searchRoute ? (
          searchPane
        ) : selection.kind === "shared" ? (
          <SharedList
            items={sharedItems}
            selectedId={selectedSharedItem?.post_id}
            onSelect={(item) => openShared(item.post_id)}
            isLoading={shared.isLoading}
          />
        ) : (
          <EntryList
            entries={list}
            selectedId={selectedEntryId}
            onSelect={openEntry}
            isLoading={entries.isLoading}
            title={selectionTitle(selection, tree.data)}
          />
        )}
      </div>

      {selection.kind === "shared" ? (
        <SharedArticle
          item={selectedSharedItem}
          tree={tree.data}
          onSubscribe={(feedUrl, feedTitle) => setSubscribeTo({ feedUrl, feedTitle })}
        />
      ) : (
        <>
          <EntryView
            entry={selectedEntry}
            onToggleStar={(id) => toggleStar.mutate(id)}
            onToggleRead={(entry) =>
              setStatus.mutate({
                ids: [entry.id],
                status: entry.status === "read" ? "unread" : "read",
              })
            }
            discussion={discussion.data}
            discussionLoading={discussion.isLoading}
            focusDiscussion={focusDiscussion}
            onShare={setSharing}
            onDiscuss={openDiscussion}
          />
        </>
      )}

      {sharing && (
        <ShareDialog
          entry={sharing}
          onCancel={() => setSharing(undefined)}
          onShare={async (message) => {
            await api.share(sharing.id, message);
            setSharing(undefined);
            void queryClient.invalidateQueries({ queryKey: ["shared"] });
            // Refetching the lookup is what makes the discussion panel appear
            // in place, below the article the user is still reading.
            void queryClient.invalidateQueries({ queryKey: ["share-lookup"] });

            // Stay on the article and open its discussion, ready for a first
            // comment. Bumping a counter re-triggers the scroll and focus even
            // if the same article is shared again later.
            setFocusDiscussion((count) => count + 1);
          }}
        />
      )}

      {showAdd && <AddSubscription tree={tree.data} onClose={() => setShowAdd(false)} />}

      {subscribeTo && (
        <AddSubscription
          tree={tree.data}
          initialFeedUrl={subscribeTo.feedUrl}
          initialTitle={subscribeTo.feedTitle}
          onClose={() => setSubscribeTo(undefined)}
        />
      )}

      {showSettings && <Settings tree={tree.data} onClose={() => setShowSettings(false)} />}

      {showNewFolder && <NewFolder onClose={() => setShowNewFolder(false)} />}

      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
