import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, api } from "./api";
import {
  useEntries,
  useKeyboard,
  useMe,
  useReadBatcher,
  useSetStatus,
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
import { useLiveUpdates } from "./useLiveUpdates";
import type { Entry, Selection, SharedRiver } from "./types";

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

function selectionTitle(selection: Selection): string {
  switch (selection.kind) {
    case "all":
      return "All items";
    case "unread":
      return "Unread";
    case "starred":
      return "Starred";
    case "shared":
      return "Shared by friends";
    default:
      return selection.title;
  }
}

export function App() {
  const queryClient = useQueryClient();
  const me = useMe();
  const tree = useTree();

  const [selection, setSelection] = useState<Selection>({ kind: "unread" });
  const [selectedEntryId, setSelectedEntryId] = useState<number>();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [sharing, setSharing] = useState<Entry>();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // Set when subscribing from a shared item, to prefill the folder picker.
  const [subscribeTo, setSubscribeTo] = useState<{ feedUrl: string; feedTitle: string }>();
  const [showSettings, setShowSettings] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [selectedSharedPost, setSelectedSharedPost] = useState<string>();
  // Set after sharing, to scroll the article's discussion into view and focus it.
  const [focusDiscussion, setFocusDiscussion] = useState(0);

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
  const selectedSharedItem =
    sharedItems.find((item) => item.post_id === selectedSharedPost) ?? sharedItems[0];

  const entries = useEntries(selection);
  const setStatus = useSetStatus(selection);
  const toggleStar = useToggleStar(selection);

  const list = useMemo(() => entries.data?.entries ?? [], [entries.data]);
  const selectedEntry = list.find((entry) => entry.id === selectedEntryId);

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
  const openShared = useCallback(
    (postID: string) => {
      setSelectedSharedPost(postID);

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

  const openDiscussion = useCallback(
    (postId: string) => {
      openShared(postId);
      setSelection({ kind: "shared" });
    },
    [openShared],
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
        ["entries", selection],
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
    [queueRead, queryClient, selection],
  );

  // Changing folders should land on nothing selected rather than a stale entry.
  const previousSelection = useRef(selection);
  useEffect(() => {
    if (previousSelection.current !== selection) {
      previousSelection.current = selection;
      setSelectedEntryId(undefined);
    }
  }, [selection]);

  const move = useCallback(
    (delta: number) => {
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
    [selection.kind, sharedItems, selectedSharedItem, openShared, list, selectedEntryId, openEntry],
  );

  /** The link the keyboard should open, whichever view is active. */
  const currentURL =
    selection.kind === "shared" ? selectedSharedItem?.link?.url : selectedEntry?.url;

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
    r: () => {
      void api.refreshAll().then(() => {
        void queryClient.invalidateQueries({ queryKey: ["tree"] });
        void queryClient.invalidateQueries({ queryKey: ["entries"] });
      });
    },
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
    "?": () => setShowShortcuts(true),
    Escape: () => {
      setShowShortcuts(false);
      setSharing(undefined);
      setShowAdd(false);
      setShowSettings(false);
    },
  });

  if (me.isLoading) {
    return <div className="centered">Loading…</div>;
  }
  if (me.isError) {
    const unauthorized = me.error instanceof ApiError && me.error.isUnauthorized;
    return unauthorized ? <SignIn /> : <div className="centered">Could not reach the server.</div>;
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>Readermost</h1>
        <button className="btn" onClick={() => void api.refreshAll()}>
          Refresh
        </button>
        {selection.kind === "shared" && (
          <button
            className="btn"
            onClick={() => {
              void api.markRiverReadAll().then(() => {
                void queryClient.invalidateQueries({ queryKey: ["shared"] });
              });
            }}
          >
            Mark all read
          </button>
        )}
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
            void api.logout().then(() => window.location.reload());
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

      {selection.kind === "shared" ? (
        <>
          <SharedList
            items={sharedItems}
            selectedId={selectedSharedItem?.post_id}
            onSelect={(item) => openShared(item.post_id)}
            isLoading={shared.isLoading}
          />
          <SharedArticle
            item={selectedSharedItem}
            tree={tree.data}
            onSubscribe={(feedUrl, feedTitle) => setSubscribeTo({ feedUrl, feedTitle })}
          />
        </>
      ) : (
        <>
          <EntryList
            entries={list}
            selectedId={selectedEntryId}
            onSelect={openEntry}
            isLoading={entries.isLoading}
            title={selectionTitle(selection)}
          />
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

      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
