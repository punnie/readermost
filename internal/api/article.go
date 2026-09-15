package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/miniflux"
	"github.com/punnie/readermost/internal/store"
)

// Where an article's text came from.
const (
	sourceSubscription = "subscription" // the reader's own Miniflux
	sourceCache        = "cache"        // copied from whoever shared it
	sourceNone         = "none"         // nobody has the text; excerpt only
)

type articleResponse struct {
	PostID      string `json:"post_id"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Author      string `json:"author,omitempty"`
	FeedTitle   string `json:"feed_title,omitempty"`
	FeedURL     string `json:"feed_url,omitempty"`
	SiteURL     string `json:"site_url,omitempty"`
	PublishedAt string `json:"published_at,omitempty"`
	ReadingTime int    `json:"reading_time,omitempty"`
	Content     string `json:"content"`

	// EntryID is the reader's own Miniflux entry, present only when they are
	// subscribed — it is what makes star and mark-read possible here.
	EntryID       int64  `json:"entry_id,omitempty"`
	Subscribed    bool   `json:"subscribed"`
	ContentSource string `json:"content_source"`
}

// handleArticle returns a shared article's text for the current reader.
//
// It tries the reader's own Miniflux first (so read state and starring work),
// then the shared cache, and finally gives back the excerpt alone. Only the
// first path depends on the reader subscribing to anything.
func (s *Server) handleArticle(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	postID := r.PathValue("id")
	if postID == "" {
		return errBadRequest("post id is required")
	}

	ctx := r.Context()
	client := identity.Mattermost(s.mm)

	snapshot, err := s.snapshot(ctx, client)
	if err != nil {
		return err
	}
	root := snapshot.find(postID)
	if root == nil {
		s.writeJSON(w, http.StatusNotFound, errorBody{Error: "not a shared article"})
		return nil
	}

	response := articleResponse{
		PostID:        root.PostID,
		URL:           root.Link.URL,
		Title:         root.Link.Title,
		Author:        root.Link.Author,
		FeedTitle:     root.Link.FeedTitle,
		FeedURL:       root.Link.FeedURL,
		SiteURL:       root.Link.FeedSiteURL,
		PublishedAt:   root.Link.PublishedAt,
		Content:       root.Link.Excerpt,
		ContentSource: sourceNone,
	}

	// 1. The reader's own copy, which also unlocks star and mark-read.
	if entry, err := s.resolveEntry(ctx, identity, root.Link.URL, root.Link.Title); err != nil {
		// Losing the article text is not worth failing the request; the
		// excerpt and the cache are still ahead.
		s.log.Warn("resolve entry failed", "error", err)
	} else if entry != nil {
		response.EntryID = entry.ID
		response.Subscribed = true
		response.Content = entry.Content
		response.ContentSource = sourceSubscription
		response.ReadingTime = entry.ReadingTime
		if entry.Author != "" {
			response.Author = entry.Author
		}
		if entry.Feed != nil {
			response.FeedURL = entry.Feed.FeedURL
			response.SiteURL = entry.Feed.SiteURL
			if response.FeedTitle == "" {
				response.FeedTitle = entry.Feed.Title
			}
		}

		// Backfill the cache for everyone else. This is what makes links
		// pasted straight into Mattermost, and shares made before the cache
		// existed, readable to people who are not subscribed.
		s.cacheEntry(ctx, root.Link.URL, entry)
		s.writeJSON(w, http.StatusOK, response)
		return nil
	}

	// 2. Whatever the sharer stored for us.
	cached, err := s.store().SharedContentByURL(ctx, normaliseURL(root.Link.URL))
	switch {
	case err == nil:
		response.Content = cached.Content
		response.ContentSource = sourceCache
		response.ReadingTime = cached.ReadingTime
		if cached.FeedURL != "" {
			response.FeedURL = cached.FeedURL
		}
		if cached.SiteURL != "" {
			response.SiteURL = cached.SiteURL
		}
		if response.Author == "" {
			response.Author = cached.Author
		}
		if response.FeedTitle == "" {
			response.FeedTitle = cached.FeedTitle
		}
	case errors.Is(err, store.ErrNotFound):
		// 3. Excerpt only, already in the response.
	default:
		return err
	}

	s.writeJSON(w, http.StatusOK, response)
	return nil
}

// resolveEntry finds the reader's own Miniflux entry for an article.
//
// Miniflux has no lookup-by-URL and its search does not index URLs, so this
// searches on the title — which does match — and confirms by comparing URLs. A
// miss is an ordinary outcome: it means the reader is not subscribed.
func (s *Server) resolveEntry(ctx context.Context, identity *auth.Identity, entryURL, title string) (*miniflux.Entry, error) {
	if title == "" {
		return nil, nil
	}

	var result *miniflux.EntryResultSet
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		result, err = client.Entries(ctx, miniflux.EntryFilter{
			Search: title,
			Limit:  25,
			Status: []string{miniflux.StatusRead, miniflux.StatusUnread},
		})
		return err
	})
	if err != nil {
		return nil, err
	}

	want := normaliseURL(entryURL)
	for _, entry := range result.Entries {
		if normaliseURL(entry.URL) == want {
			return entry, nil
		}
	}
	return nil, nil
}

// cacheEntry stores an article so readers without the feed can still read it.
func (s *Server) cacheEntry(ctx context.Context, entryURL string, entry *miniflux.Entry) {
	content := &store.SharedContent{
		URL:         normaliseURL(entryURL),
		Title:       entry.Title,
		Author:      entry.Author,
		Content:     entry.Content,
		ReadingTime: entry.ReadingTime,
	}
	if !entry.PublishedAt.IsZero() {
		content.PublishedAt = entry.PublishedAt.Unix()
	}
	if entry.Feed != nil {
		content.FeedTitle = entry.Feed.Title
		content.FeedURL = entry.Feed.FeedURL
		content.SiteURL = entry.Feed.SiteURL
	}

	if err := s.store().PutSharedContent(ctx, content); err != nil {
		// Caching is opportunistic; a failure costs the next reader a fallback
		// to the excerpt, nothing more.
		s.log.Warn("cache shared content failed", "error", err)
	}
}

// store is the app database, reached through the auth service that owns it.
func (s *Server) store() *store.Store { return s.auth.Store() }
