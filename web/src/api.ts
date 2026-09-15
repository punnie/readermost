import type {
  Entry,
  EntryResultSet,
  Me,
  SharedArticleData,
  SharedItem,
  SharedRiver,
  ShareLookup,
  ThreadMessage,
  Tree,
} from "./types";

/**
 * Every mutating request carries this header. A cross-site form post cannot set
 * a custom header, which together with SameSite=Lax cookies is what stands in
 * for CSRF tokens.
 */
const CSRF_HEADER = "X-Readermost";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when the session is gone and the user must sign in again. */
  get isUnauthorized() {
    return this.status === 401;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);

  if (method !== "GET" && method !== "HEAD") {
    headers.set(CSRF_HEADER, "1");
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // A non-JSON error body is not worth reporting verbatim.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export interface EntryQuery {
  status?: ("read" | "unread" | "removed")[];
  feedId?: number;
  categoryId?: number;
  starred?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  order?: string;
  direction?: "asc" | "desc";
}

function entryParams(query: EntryQuery): string {
  const params = new URLSearchParams();
  query.status?.forEach((status) => params.append("status", status));
  if (query.feedId) params.set("feed_id", String(query.feedId));
  if (query.categoryId) params.set("category_id", String(query.categoryId));
  if (query.starred !== undefined) params.set("starred", String(query.starred));
  if (query.search) params.set("search", query.search);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  if (query.order) params.set("order", query.order);
  if (query.direction) params.set("direction", query.direction);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  me: () => request<Me>("/api/me"),

  tree: () => request<Tree>("/api/tree"),

  entries: (query: EntryQuery) =>
    request<EntryResultSet>(`/api/entries${entryParams(query)}`),

  entry: (id: number) => request<Entry>(`/api/entries/${id}`),

  setEntryStatus: (entryIds: number[], status: "read" | "unread") =>
    request<void>("/api/entries/status", {
      method: "PUT",
      body: JSON.stringify({ entry_ids: entryIds, status }),
    }),

  toggleBookmark: (id: number) =>
    request<void>(`/api/entries/${id}/bookmark`, { method: "PUT" }),

  fetchOriginal: (id: number) =>
    request<{ content: string }>(`/api/entries/${id}/original`),

  markRead: (scope: "all" | "category" | "feed", id?: number) =>
    request<void>("/api/mark-read", {
      method: "POST",
      body: JSON.stringify({
        scope,
        ...(scope === "category" ? { category_id: id } : {}),
        ...(scope === "feed" ? { feed_id: id } : {}),
      }),
    }),

  refreshAll: () => request<void>("/api/feeds/refresh", { method: "POST" }),

  discover: (url: string) =>
    request<{ title: string; url: string; type: string }[]>("/api/discover", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  createFeed: (feedUrl: string, categoryId: number) =>
    request<{ feed_id: number }>("/api/feeds", {
      method: "POST",
      body: JSON.stringify({ feed_url: feedUrl, category_id: categoryId }),
    }),

  updateFeed: (id: number, changes: { title?: string; category_id?: number }) =>
    request<unknown>(`/api/feeds/${id}`, {
      method: "PUT",
      body: JSON.stringify(changes),
    }),

  deleteFeed: (id: number) =>
    request<void>(`/api/feeds/${id}`, { method: "DELETE" }),

  createCategory: (title: string) =>
    request<{ id: number; title: string }>("/api/categories", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  updateCategory: (id: number, title: string) =>
    request<unknown>(`/api/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),

  deleteCategory: (id: number) =>
    request<void>(`/api/categories/${id}`, { method: "DELETE" }),

  importOPML: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ message: string }>("/api/import", {
      method: "POST",
      body: form,
    });
  },

  markOnboarded: () => request<void>("/api/onboarded", { method: "POST" }),

  lookupShare: (url: string) =>
    request<ShareLookup>(`/api/shared/lookup?url=${encodeURIComponent(url)}`),

  shared: () => request<SharedRiver>("/api/shared"),

  sharedArticle: (postId: string) =>
    request<SharedArticleData>(`/api/shared/${postId}/article`),

  markRiverRead: (postId: string, read = true) =>
    request<void>(`/api/shared/${postId}/read`, {
      method: "POST",
      body: JSON.stringify({ read }),
    }),

  markRiverReadAll: () =>
    request<void>("/api/shared/read-all", { method: "POST" }),

  share: (entryId: number, message: string) =>
    request<SharedItem>("/api/share", {
      method: "POST",
      body: JSON.stringify({ entry_id: entryId, message }),
    }),

  thread: (postId: string) =>
    request<{ messages: ThreadMessage[] }>(`/api/shared/${postId}/thread`),

  comment: (postId: string, message: string) =>
    request<ThreadMessage>(`/api/shared/${postId}/comment`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  logout: () => request<void>("/auth/logout", { method: "POST" }),
};
