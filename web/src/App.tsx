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
import { SharedRiver } from "./components/SharedRiver";
import { ShareDialog } from "./components/ShareDialog";
import { Shortcuts } from "./components/Shortcuts";
import { Sidebar } from "./components/Sidebar";
import { Welcome } from "./components/Welcome";
import { AddSubscription } from "./components/AddSubscription";
import { Settings } from "./components/Settings";
import { useLiveUpdates } from "./useLiveUpdates";
import type { Entry, Selection } from "./types";

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
  const [showSettings, setShowSettings] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [focusSharedPost, setFocusSharedPost] = useState<string>();

  // Live shared-channel updates, once we know who we are.
  useLiveUpdates(Boolean(me.data));

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

  const openDiscussion = useCallback((postId: string) => {
    setFocusSharedPost(postId);
    setSelection({ kind: "shared" });
  }, []);

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
      if (list.length === 0) return;
      const current = list.findIndex((entry) => entry.id === selectedEntryId);
      const next = current === -1 ? 0 : Math.min(Math.max(current + delta, 0), list.length - 1);
      const entry = list[next];
      if (entry) openEntry(entry);
    },
    [list, selectedEntryId, openEntry],
  );

  // `g` is a prefix: g then u/a/s jumps between views.
  const pendingGoto = useRef(false);

  useKeyboard({
    j: () => move(1),
    k: () => move(-1),
    o: () => selectedEntry && window.open(selectedEntry.url, "_blank", "noopener"),
    Enter: () => selectedEntry && window.open(selectedEntry.url, "_blank", "noopener"),
    v: () => selectedEntry && window.open(selectedEntry.url, "_blank", "noopener"),
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
        <div className="pane entry-list" style={{ gridColumn: "2 / -1" }}>
          <SharedRiver
            focusPostId={focusSharedPost}
            onFocusHandled={() => setFocusSharedPost(undefined)}
          />
        </div>
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
            const created = await api.share(sharing.id, message);
            setSharing(undefined);
            void queryClient.invalidateQueries({ queryKey: ["shared"] });
            void queryClient.invalidateQueries({ queryKey: ["share-lookup"] });

            // Drop the user into the discussion they just started, rather than
            // leaving them on the article wondering whether it worked.
            setFocusSharedPost(created.post_id);
            setSelection({ kind: "shared" });
          }}
        />
      )}

      {showAdd && <AddSubscription tree={tree.data} onClose={() => setShowAdd(false)} />}

      {showSettings && <Settings tree={tree.data} onClose={() => setShowSettings(false)} />}

      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
