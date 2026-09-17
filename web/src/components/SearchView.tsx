import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { fold, matchFeeds, mayNeedAccents } from "../search";
import { formatListDate, timeAgo } from "../format";
import { FeedIcon } from "./FeedIcon";
import { Avatar } from "./Avatar";
import type { Entry, Selection, SharedItem, Tree } from "../types";

interface Props {
  query: string;
  scope?: Selection;
  /** Where the reader came from, offered as a scope to narrow to. */
  scopeCandidate?: { selection: Selection; title: string };
  tree?: Tree;
  entries: Entry[];
  entriesLoading: boolean;
  selectedEntryId?: number;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: Selection | undefined) => void;
  onOpenEntry: (entry: Entry) => void;
  onOpenFeed: (selection: Selection) => void;
  onOpenShared: (postId: string) => void;
}

/** One search box over three sources: feeds, articles and the shared river. */
export function SearchView({
  query,
  scope,
  scopeCandidate,
  tree,
  entries,
  entriesLoading,
  selectedEntryId,
  onQueryChange,
  onScopeChange,
  onOpenEntry,
  onOpenFeed,
  onOpenShared,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(query);

  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Feeds are matched locally, so they appear while the article request is
  // still in flight. That is most of why this feels immediate.
  const feeds = useMemo(() => matchFeeds(tree, draft).slice(0, 6), [tree, draft]);

  const shared = useQuery({
    queryKey: ["search-shared", query],
    queryFn: () => api.searchShared(query),
    enabled: query.trim().length > 1,
  });
  const sharedItems: SharedItem[] = shared.data?.items ?? [];

  const nothingAnywhere =
    query.trim().length > 1 &&
    !entriesLoading &&
    feeds.length === 0 &&
    entries.length === 0 &&
    sharedItems.length === 0;

  return (
    <div className="pane search-view">
      <div className="search-head">
        <div className="search-field">
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            value={draft}
            placeholder="Search articles, feeds and shared links"
            autoComplete="off"
            onChange={(event) => {
              setDraft(event.target.value);
              onQueryChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && draft) {
                event.preventDefault();
                setDraft("");
                onQueryChange("");
              }
            }}
          />

          {draft && (
            <button
              className="search-clear"
              aria-label="Clear the search"
              onClick={() => {
                setDraft("");
                onQueryChange("");
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
        </div>

        {scopeCandidate && (
          <div className="scope-chips">
            <button
              className={`chip ${scope ? "" : "active"}`}
              onClick={() => onScopeChange(undefined)}
            >
              Everywhere
            </button>
            <button
              className={`chip ${scope ? "active" : ""}`}
              onClick={() => onScopeChange(scopeCandidate.selection)}
            >
              {scopeCandidate.title}
            </button>
          </div>
        )}
      </div>

      {query.trim().length <= 1 && (
        <p className="search-hint">Type at least two characters.</p>
      )}

      {feeds.length > 0 && (
        <section className="search-section">
          <h4>
            Feeds <span className="count">{feeds.length}</span>
          </h4>
          {feeds.map(({ feed, folder }) => (
            <button
              key={feed.id}
              className="search-row"
              onClick={() => onOpenFeed({ kind: "feed", id: feed.id })}
            >
              <FeedIcon feedId={feed.id} hasIcon={feed.has_icon} />
              <span className="title">{feed.title}</span>
              <span className="meta">{folder}</span>
              {feed.unread > 0 && <span className="count">{feed.unread}</span>}
            </button>
          ))}
        </section>
      )}

      <section className="search-section">
        <h4>
          Articles{" "}
          {entriesLoading ? (
            <span className="count">…</span>
          ) : (
            <span className="count">{entries.length}</span>
          )}
        </h4>

        {!entriesLoading && entries.length === 0 && query.trim().length > 1 && (
          <p className="search-empty">
            No articles matched.
            {mayNeedAccents(query) && (
              <>
                {" "}
                Article search is accent-sensitive, so <code>{query}</code> will
                not find <em>{query.replace(/a/i, "á")}</em> — try typing the
                accents.
              </>
            )}
          </p>
        )}

        {entries.map((entry) => (
          <button
            key={entry.id}
            className={`search-row entry ${entry.id === selectedEntryId ? "selected" : ""} ${
              entry.status === "read" ? "read" : ""
            }`}
            onClick={() => onOpenEntry(entry)}
          >
            <span className="title">{entry.title}</span>
            <span className="meta">
              {entry.feed?.title} · {formatListDate(entry.published_at)}
            </span>
          </button>
        ))}
      </section>

      {sharedItems.length > 0 && (
        <section className="search-section">
          <h4>
            Shared <span className="count">{sharedItems.length}</span>
          </h4>
          {sharedItems.map((item) => (
            <button
              key={item.post_id}
              className="search-row"
              onClick={() => onOpenShared(item.post_id)}
            >
              <Avatar
                userId={item.author.user_id}
                name={item.author.display_name || item.author.username}
                size={18}
              />
              <span className="title">{item.link?.title ?? item.message}</span>
              <span className="meta">
                {item.author.display_name || item.author.username} ·{" "}
                {timeAgo(item.created_at)}
              </span>
            </button>
          ))}
        </section>
      )}

      {nothingAnywhere && !mayNeedAccents(query) && (
        <p className="search-empty">Nothing matched “{fold(query)}”.</p>
      )}
    </div>
  );
}
