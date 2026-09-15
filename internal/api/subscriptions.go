package api

import (
	"net/http"
	"strings"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/miniflux"
)

type createFeedRequest struct {
	FeedURL    string `json:"feed_url"`
	CategoryID int64  `json:"category_id"`
}

func (s *Server) handleCreateFeed(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	var request createFeedRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	if err := validateFeedURL(request.FeedURL); err != nil {
		return err
	}
	if request.CategoryID <= 0 {
		return errBadRequest("category_id is required")
	}

	ctx := r.Context()
	var feedID int64
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		feedID, err = client.CreateFeed(ctx, request.FeedURL, request.CategoryID)
		return err
	})
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusCreated, map[string]int64{"feed_id": feedID})
	return nil
}

type updateFeedRequest struct {
	Title      *string `json:"title,omitempty"`
	CategoryID *int64  `json:"category_id,omitempty"`
}

func (s *Server) handleUpdateFeed(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	var request updateFeedRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	if request.Title == nil && request.CategoryID == nil {
		return errBadRequest("nothing to update")
	}
	if request.Title != nil && strings.TrimSpace(*request.Title) == "" {
		return errBadRequest("title cannot be empty")
	}

	ctx := r.Context()
	var feed *miniflux.Feed
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		feed, err = client.UpdateFeed(ctx, id, request.Title, request.CategoryID)
		return err
	})
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusOK, feed)
	return nil
}

func (s *Server) handleDeleteFeed(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	ctx := r.Context()
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		return client.DeleteFeed(ctx, id)
	})
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) handleRefreshFeed(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	ctx := r.Context()
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		return client.RefreshFeed(ctx, id)
	})
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusAccepted)
	return nil
}

func (s *Server) handleRefreshAll(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	ctx := r.Context()
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		return client.RefreshAllFeeds(ctx)
	})
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusAccepted)
	return nil
}

type discoverRequest struct {
	URL string `json:"url"`
}

func (s *Server) handleDiscover(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	var request discoverRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	if err := validateFeedURL(request.URL); err != nil {
		return err
	}

	ctx := r.Context()
	var subscriptions []*miniflux.Subscription
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		subscriptions, err = client.Discover(ctx, request.URL)
		return err
	})
	if err != nil {
		return err
	}
	if subscriptions == nil {
		subscriptions = []*miniflux.Subscription{}
	}

	s.writeJSON(w, http.StatusOK, subscriptions)
	return nil
}

type categoryRequest struct {
	Title string `json:"title"`
}

func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	var request categoryRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	title := strings.TrimSpace(request.Title)
	if title == "" {
		return errBadRequest("title is required")
	}

	ctx := r.Context()
	var category *miniflux.Category
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		category, err = client.CreateCategory(ctx, title)
		return err
	})
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusCreated, category)
	return nil
}

func (s *Server) handleUpdateCategory(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	var request categoryRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	title := strings.TrimSpace(request.Title)
	if title == "" {
		return errBadRequest("title is required")
	}

	ctx := r.Context()
	var category *miniflux.Category
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		category, err = client.UpdateCategory(ctx, id, title)
		return err
	})
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusOK, category)
	return nil
}

func (s *Server) handleDeleteCategory(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	ctx := r.Context()
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		return client.DeleteCategory(ctx, id)
	})
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

type markReadRequest struct {
	Scope      string `json:"scope"` // all, category, feed
	CategoryID int64  `json:"category_id,omitempty"`
	FeedID     int64  `json:"feed_id,omitempty"`
}

func (s *Server) handleMarkRead(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	var request markReadRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}

	ctx := r.Context()
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		switch request.Scope {
		case "all":
			return client.MarkAllRead(ctx, identity.User.MinifluxUserID)
		case "category":
			if request.CategoryID <= 0 {
				return errBadRequest("category_id is required")
			}
			return client.MarkCategoryRead(ctx, request.CategoryID)
		case "feed":
			if request.FeedID <= 0 {
				return errBadRequest("feed_id is required")
			}
			return client.MarkFeedRead(ctx, request.FeedID)
		default:
			return errBadRequest("scope must be all, category or feed")
		}
	})
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

// validateFeedURL keeps the proxy from being pointed at arbitrary schemes.
// Miniflux does its own fetching, but there is no reason to relay file:// or
// gopher:// URLs to it.
func validateFeedURL(raw string) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return errBadRequest("url is required")
	}
	lower := strings.ToLower(trimmed)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return errBadRequest("url must start with http:// or https://")
	}
	return nil
}
