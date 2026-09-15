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
  url: string;
  title?: string;
  feed_title?: string;
  feed_site_url?: string;
  author?: string;
  published_at?: string;
  from_readermost: boolean;
}

export interface SharedItem {
  post_id: string;
  created_at: number;
  message: string;
  reply_count: number;
  author: SharedAuthor;
  link?: SharedLink;
  permalink: string;
}

export interface SharedRiver {
  items: SharedItem[];
  before?: string;
}

export interface ThreadMessage {
  post_id: string;
  created_at: number;
  message: string;
  author: SharedAuthor;
  is_root: boolean;
}

/** What the middle pane is currently listing. */
export type Selection =
  | { kind: "all" }
  | { kind: "unread" }
  | { kind: "starred" }
  | { kind: "shared" }
  | { kind: "category"; id: number; title: string }
  | { kind: "feed"; id: number; title: string };
