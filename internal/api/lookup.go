package api

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/mattermost"
)

// How far back the share index reaches, and how long it is trusted.
//
// Mattermost's search cannot answer "has this URL been shared?" — its Postgres
// backend tokenises on words, so a full URL or a hyphenated slug matches
// nothing. The only reliable source is the channel itself, so Readermost scans
// it and remembers the result briefly.
const (
	maxIndexPosts  = 600
	indexPageSize  = 200
	indexFreshness = 30 * time.Second
)

// shareRecord is one shared link, as the index remembers it.
type shareRecord struct {
	PostID     string
	UserID     string
	CreateAt   int64
	ReplyCount int
}

// shareIndex maps entry URLs to their discussion.
//
// It is shared by every user, which is safe because the channel is the same for
// everyone: a user who cannot read the channel cannot reach these endpoints at
// all, since building the index uses their own token.
type shareIndex struct {
	mu      sync.Mutex
	builtAt time.Time
	byURL   map[string]*shareRecord
}

// lookup returns the discussion for a URL, refreshing the index if it is stale.
func (s *Server) lookupShare(ctx context.Context, client *mattermost.Client, entryURL string) (*shareRecord, error) {
	s.shares.mu.Lock()
	defer s.shares.mu.Unlock()

	if time.Since(s.shares.builtAt) > indexFreshness || s.shares.byURL == nil {
		index, err := s.buildShareIndex(ctx, client)
		if err != nil {
			return nil, err
		}
		s.shares.byURL = index
		s.shares.builtAt = time.Now()
	}
	return s.shares.byURL[entryURL], nil
}

// noteShare adds a just-created share so the button flips to "Discuss"
// immediately rather than after the index expires.
func (s *Server) noteShare(entryURL string, record *shareRecord) {
	s.shares.mu.Lock()
	defer s.shares.mu.Unlock()

	if s.shares.byURL == nil {
		s.shares.byURL = make(map[string]*shareRecord)
	}
	if existing, ok := s.shares.byURL[entryURL]; ok && existing.CreateAt <= record.CreateAt {
		// Keep the oldest, so everyone converges on one discussion.
		return
	}
	s.shares.byURL[entryURL] = record
}

// buildShareIndex walks the channel and records every URL it finds.
func (s *Server) buildShareIndex(ctx context.Context, client *mattermost.Client) (map[string]*shareRecord, error) {
	index := make(map[string]*shareRecord)
	replies := make(map[string]int)
	roots := make(map[string]*mattermost.Post)

	before := ""
	for scanned := 0; scanned < maxIndexPosts; scanned += indexPageSize {
		list, err := client.ChannelPosts(ctx, s.cfg.Mattermost.SharedChannelID,
			mattermost.ChannelPostOptions{PerPage: indexPageSize, Before: before})
		if err != nil {
			return nil, err
		}

		ordered := list.Ordered()
		if len(ordered) == 0 {
			break
		}

		for _, post := range list.Posts {
			if post.DeleteAt != 0 || post.IsSystemMessage() {
				continue
			}
			if post.RootID != "" {
				replies[post.RootID]++
				continue
			}
			roots[post.ID] = post
		}

		before = ordered[len(ordered)-1].ID
		if len(ordered) < indexPageSize {
			break
		}
	}

	for _, post := range roots {
		url := shareURLOf(post)
		if url == "" {
			continue
		}
		record := &shareRecord{
			PostID:     post.ID,
			UserID:     post.UserID,
			CreateAt:   post.CreateAt,
			ReplyCount: replies[post.ID],
		}
		// Oldest wins: the first person to share something owns the thread.
		if existing, ok := index[url]; ok && existing.CreateAt <= record.CreateAt {
			continue
		}
		index[url] = record
	}
	return index, nil
}

// shareURLOf extracts the article a post points at: from Readermost's props if
// present, otherwise the first URL in the message.
func shareURLOf(post *mattermost.Post) string {
	if link, ok := post.SharedLink(); ok {
		return link.EntryURL
	}
	found := urlPattern.FindString(post.Message)
	if found == "" {
		return ""
	}
	return strings.TrimRight(found, ".,;:!?")
}

type lookupResponse struct {
	Shared     bool          `json:"shared"`
	PostID     string        `json:"post_id,omitempty"`
	ReplyCount int           `json:"reply_count,omitempty"`
	Permalink  string        `json:"permalink,omitempty"`
	CreatedAt  int64         `json:"created_at,omitempty"`
	Author     *sharedAuthor `json:"author,omitempty"`
	// MineAlready reports whether the caller is the one who shared it, which is
	// what the share button uses to refuse a second copy.
	MineAlready bool `json:"mine_already,omitempty"`
}

// handleLookupShare answers "has this article already been shared?".
func (s *Server) handleLookupShare(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	entryURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if entryURL == "" {
		return errBadRequest("url is required")
	}

	ctx := r.Context()
	client := identity.Mattermost(s.mm)

	record, err := s.lookupShare(ctx, client, entryURL)
	if err != nil {
		return err
	}
	if record == nil {
		s.writeJSON(w, http.StatusOK, lookupResponse{Shared: false})
		return nil
	}

	response := lookupResponse{
		Shared:      true,
		PostID:      record.PostID,
		ReplyCount:  record.ReplyCount,
		CreatedAt:   record.CreateAt,
		Permalink:   s.mm.BaseURL() + "/_redirect/pl/" + record.PostID,
		Author:      &sharedAuthor{UserID: record.UserID},
		MineAlready: record.UserID == identity.User.MattermostUserID,
	}

	if users, err := client.UsersByIDs(ctx, []string{record.UserID}); err == nil && len(users) > 0 {
		response.Author.Username = users[0].Username
		response.Author.DisplayName = users[0].DisplayName()
	}

	s.writeJSON(w, http.StatusOK, response)
	return nil
}
