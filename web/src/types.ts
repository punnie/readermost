export interface Me {
  user_id: string;
  username: string;
  display_name: string;
  onboarded: boolean;
  mattermost_url: string;
  shared_channel_id: string;
}

export interface TreeFeed {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
  unread: number;
  has_icon: boolean;
  disabled: boolean;
  error?: string;
}

/** Miniflux categories are flat, so this is the entire hierarchy. */
export interface TreeCategory {
  id: number;
  title: string;
  unread: number;
  feeds: TreeFeed[];
}

export interface Tree {
  categories: TreeCategory[];
  total_unread: number;
}

export interface EntryFeed {
  id: number;
  title: string;
  site_url: string;
}

export interface Entry {
  id: number;
  feed_id: number;
  status: "read" | "unread" | "removed";
  title: string;
  url: string;
  comments_url: string;
  author: string;
  content: string;
  published_at: string;
  starred: boolean;
  reading_time: number;
  feed?: EntryFeed;
}

export interface EntryResultSet {
  total: number;
  entries: Entry[];
}

export interface SharedAuthor {
  user_id: string;
  username: string;
  display_name: string;
}

export interface SharedLink {
  feed_url?: string;
  url: string;
  title?: string;
  feed_title?: string;
  feed_site_url?: string;
  author?: string;
  published_at?: string;
  excerpt?: string;
  from_readermost: boolean;
}

export interface SharedItem {
  post_id: string;
  created_at: number;
  message: string;
  reply_count: number;
  /** River read state is Readermost's own; Miniflux knows nothing of it. */
  read: boolean;
  unseen_replies: number;
  author: SharedAuthor;
  link?: SharedLink;
  permalink: string;
}

export interface SharedRiver {
  unread: number;
  items: SharedItem[];

}

export interface ThreadMessage {
  post_id: string;
  created_at: number;
  message: string;
  author: SharedAuthor;
  is_root: boolean;
}

/**
 * What the middle pane is currently listing.
 *
 * Carries no title: a selection is addressable by URL, and a URL has only the
 * id. Titles are looked up from the tree wherever they are shown.
 */
export type Selection =
  | { kind: "all" }
  | { kind: "unread" }
  | { kind: "starred" }
  | { kind: "shared" }
  | { kind: "category"; id: number }
  | { kind: "feed"; id: number };

/** Whether an article already has a discussion in the shared channel. */
export interface ShareLookup {
  shared: boolean;
  post_id?: string;
  reply_count?: number;
  permalink?: string;
  created_at?: number;
  author?: SharedAuthor;
}

/** Where a shared article's text came from. */
export type ContentSource = "subscription" | "cache" | "none";

/** A shared article, resolved for the current reader. */
export interface SharedArticleData {
  post_id: string;
  url: string;
  title: string;
  author?: string;
  feed_title?: string;
  feed_url?: string;
  site_url?: string;
  published_at?: string;
  reading_time?: number;
  content: string;
  /** Present only when the reader subscribes, enabling star and mark-read. */
  entry_id?: number;
  subscribed: boolean;
  content_source: ContentSource;
}
