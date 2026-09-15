package api

import (
	"encoding/base64"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/miniflux"
)

type meResponse struct {
	UserID          string `json:"user_id"`
	Username        string `json:"username"`
	DisplayName     string `json:"display_name"`
	Onboarded       bool   `json:"onboarded"`
	MattermostURL   string `json:"mattermost_url"`
	SharedChannelID string `json:"shared_channel_id"`
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	mmUser, err := identity.Mattermost(s.mm).Me(r.Context())
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusOK, meResponse{
		UserID:          mmUser.ID,
		Username:        mmUser.Username,
		DisplayName:     mmUser.DisplayName(),
		Onboarded:       identity.User.OnboardedAt != nil,
		MattermostURL:   s.mm.BaseURL(),
		SharedChannelID: s.cfg.Mattermost.SharedChannelID,
	})
	return nil
}

// treeFeed is a subscription as the sidebar needs it.
type treeFeed struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	SiteURL  string `json:"site_url"`
	FeedURL  string `json:"feed_url"`
	Unread   int    `json:"unread"`
	HasIcon  bool   `json:"has_icon"`
	Disabled bool   `json:"disabled"`
	Error    string `json:"error,omitempty"`
}

// treeCategory is a folder. Miniflux categories are flat, so this is the whole
// hierarchy: one level of folders, each holding feeds.
type treeCategory struct {
	ID     int64      `json:"id"`
	Title  string     `json:"title"`
	Unread int        `json:"unread"`
	Feeds  []treeFeed `json:"feeds"`
}

type treeResponse struct {
	Categories  []treeCategory `json:"categories"`
	TotalUnread int            `json:"total_unread"`
}

func (s *Server) handleTree(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	ctx := r.Context()

	var (
		categories []*miniflux.Category
		feeds      []*miniflux.Feed
		counters   *miniflux.FeedCounters
	)

	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		if categories, err = client.Categories(ctx, true); err != nil {
			return err
		}
		if feeds, err = client.Feeds(ctx); err != nil {
			return err
		}
		// Per-feed unread counts are a separate endpoint; category listings only
		// carry their own totals.
		counters, err = client.FeedCounters(ctx)
		return err
	})
	if err != nil {
		return err
	}

	byCategory := make(map[int64]*treeCategory, len(categories))
	response := treeResponse{Categories: make([]treeCategory, 0, len(categories))}

	for _, category := range categories {
		byCategory[category.ID] = &treeCategory{
			ID:    category.ID,
			Title: category.Title,
			Feeds: []treeFeed{},
		}
	}

	for _, feed := range feeds {
		if feed.Category == nil {
			continue
		}
		parent, ok := byCategory[feed.Category.ID]
		if !ok {
			continue
		}

		unread := counters.Unread(feed.ID)
		parent.Feeds = append(parent.Feeds, treeFeed{
			ID:       feed.ID,
			Title:    feed.Title,
			SiteURL:  feed.SiteURL,
			FeedURL:  feed.FeedURL,
			Unread:   unread,
			HasIcon:  feed.Icon != nil,
			Disabled: feed.Disabled,
			Error:    feed.ParsingErrorMsg,
		})
		// Sum from feeds rather than trusting the category total, so the folder
		// badge and its children can never disagree on screen.
		parent.Unread += unread
	}

	for _, category := range categories {
		entry := byCategory[category.ID]
		sort.Slice(entry.Feeds, func(i, j int) bool {
			return strings.ToLower(entry.Feeds[i].Title) < strings.ToLower(entry.Feeds[j].Title)
		})
		response.Categories = append(response.Categories, *entry)
		response.TotalUnread += entry.Unread
	}

	sort.Slice(response.Categories, func(i, j int) bool {
		return strings.ToLower(response.Categories[i].Title) < strings.ToLower(response.Categories[j].Title)
	})

	s.writeJSON(w, http.StatusOK, response)
	return nil
}

// allowedEntryOrder guards the order parameter: it is interpolated into a
// Miniflux query, so only known-good values pass.
var allowedEntryOrder = map[string]bool{
	"id": true, "status": true, "published_at": true,
	"category_title": true, "category_id": true,
}

func (s *Server) handleEntries(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	ctx := r.Context()
	query := r.URL.Query()

	filter := miniflux.EntryFilter{
		Limit:  50,
		Order:  "published_at",
		Search: strings.TrimSpace(query.Get("search")),
	}

	for _, status := range query["status"] {
		switch status {
		case miniflux.StatusRead, miniflux.StatusUnread, miniflux.StatusRemoved:
			filter.Status = append(filter.Status, status)
		default:
			return errBadRequest("invalid status")
		}
	}

	if raw := query.Get("feed_id"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value <= 0 {
			return errBadRequest("invalid feed_id")
		}
		filter.FeedID = value
	}
	if raw := query.Get("category_id"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value <= 0 {
			return errBadRequest("invalid category_id")
		}
		filter.CategoryID = value
	}
	if raw := query.Get("starred"); raw != "" {
		starred := raw == "true"
		filter.Starred = &starred
	}
	if raw := query.Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 || value > 200 {
			return errBadRequest("limit must be between 1 and 200")
		}
		filter.Limit = value
	}
	if raw := query.Get("offset"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			return errBadRequest("invalid offset")
		}
		filter.Offset = value
	}
	if raw := query.Get("order"); raw != "" {
		if !allowedEntryOrder[raw] {
			return errBadRequest("invalid order")
		}
		filter.Order = raw
	}
	switch raw := query.Get("direction"); raw {
	case "":
		filter.Direction = "desc"
	case "asc", "desc":
		filter.Direction = raw
	default:
		return errBadRequest("invalid direction")
	}

	var result *miniflux.EntryResultSet
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		result, err = client.Entries(ctx, filter)
		return err
	})
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusOK, result)
	return nil
}

func (s *Server) handleEntry(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	ctx := r.Context()
	var entry *miniflux.Entry
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		entry, err = client.Entry(ctx, id)
		return err
	})
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusOK, entry)
	return nil
}

type updateStatusRequest struct {
	EntryIDs []int64 `json:"entry_ids"`
	Status   string  `json:"status"`
}

func (s *Server) handleUpdateEntryStatus(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	var request updateStatusRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	if len(request.EntryIDs) == 0 {
		return errBadRequest("entry_ids is required")
	}
	// The reader batches scroll-to-read, but an unbounded list would let one
	// request stall Miniflux for everyone.
	if len(request.EntryIDs) > 500 {
		return errBadRequest("too many entry_ids (max 500)")
	}
	switch request.Status {
	case miniflux.StatusRead, miniflux.StatusUnread, miniflux.StatusRemoved:
	default:
		return errBadRequest("invalid status")
	}

	ctx := r.Context()
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		return client.UpdateEntryStatus(ctx, request.EntryIDs, request.Status)
	})
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) handleToggleBookmark(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	ctx := r.Context()
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		return client.ToggleBookmark(ctx, id)
	})
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) handleFetchOriginal(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	ctx := r.Context()
	var content string
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		content, err = client.FetchOriginalContent(ctx, id)
		return err
	})
	if err != nil {
		return err
	}

	s.writeJSON(w, http.StatusOK, map[string]string{"content": content})
	return nil
}

// handleFeedIcon re-serves a favicon as real image bytes. Miniflux hands them
// over base64-encoded inside JSON, which no <img> tag can use directly.
func (s *Server) handleFeedIcon(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	id, err := pathInt(r, "id")
	if err != nil {
		return err
	}

	ctx := r.Context()
	var icon *miniflux.Icon
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		icon, err = client.FeedIcon(ctx, id)
		return err
	})
	if err != nil {
		return err
	}

	// Data arrives as "image/png;base64,iVBOR..." — strip the prefix.
	payload := icon.Data
	if comma := strings.IndexByte(payload, ','); comma >= 0 {
		payload = payload[comma+1:]
	}
	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return errBadRequest("icon could not be decoded")
	}

	mimeType := icon.MimeType
	if mimeType == "" {
		mimeType = "image/png"
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(decoded)
	return nil
}
