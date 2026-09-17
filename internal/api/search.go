package api

import (
	"net/http"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/punnie/readermost/internal/auth"
)

// maxSharedResults caps a search of the river. The snapshot holds at most a few
// hundred posts, and nobody scrolls past twenty.
const maxSharedResults = 20

// folder strips accents and lowercases, so a query typed without accents finds
// an accented title.
//
// Miniflux cannot do this for article bodies — its Postgres index keeps the
// accents — but the river is searched here, where both sides can be folded the
// same way.
var folder = transform.Chain(
	norm.NFD,
	runes.Remove(runes.In(unicode.Mn)),
	norm.NFC,
)

func fold(text string) string {
	folded, _, err := transform.String(folder, text)
	if err != nil {
		// Transform only fails on malformed input; the raw text still compares.
		return strings.ToLower(text)
	}
	return strings.ToLower(folded)
}

// matchesShared reports whether a shared item satisfies every term in the query.
//
// Terms are ANDed, matching how Miniflux treats a multi-word article search, so
// the two halves of one search box behave the same way.
func matchesShared(root *rootPost, terms []string) bool {
	if root.Link == nil {
		return false
	}

	haystack := fold(strings.Join([]string{
		root.Link.Title,
		root.Link.FeedTitle,
		root.Link.Excerpt,
		root.Link.Author,
		root.Message,
	}, " "))

	for _, term := range terms {
		if !strings.Contains(haystack, term) {
			return false
		}
	}
	return true
}

// handleSearchShared searches the shared river.
//
// It runs over the cached channel snapshot rather than Mattermost's search API:
// the snapshot is already in memory, it needs no upstream call, and Mattermost's
// search does not index URLs. Its reach is the snapshot's reach, which is the
// river's reach anyway.
func (s *Server) handleSearchShared(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		s.writeJSON(w, http.StatusOK, sharedRiverResponse{Items: []sharedItem{}})
		return nil
	}

	terms := strings.Fields(fold(query))

	ctx := r.Context()
	client := identity.Mattermost(s.mm)

	snapshot, err := s.snapshot(ctx, client)
	if err != nil {
		return err
	}

	reads, err := s.store().RiverReads(ctx, identity.User.ID)
	if err != nil {
		return err
	}

	matched := make([]*rootPost, 0, maxSharedResults)
	for _, root := range snapshot.roots {
		if matchesShared(root, terms) {
			matched = append(matched, root)
		}
	}

	sort.Slice(matched, func(i, j int) bool {
		return matched[i].CreateAt > matched[j].CreateAt
	})
	if len(matched) > maxSharedResults {
		matched = matched[:maxSharedResults]
	}

	items := make([]sharedItem, 0, len(matched))
	authorIDs := make(map[string]struct{}, len(matched))

	for _, root := range matched {
		read, seen := reads[root.PostID]

		item := sharedItem{
			PostID:     root.PostID,
			CreatedAt:  root.CreateAt,
			Message:    root.Message,
			ReplyCount: root.ReplyCount,
			Author:     sharedAuthor{UserID: root.UserID},
			Link:       root.Link,
			Permalink:  s.mm.BaseURL() + "/_redirect/pl/" + root.PostID,
			Read:       seen,
		}
		if seen {
			item.UnseenReplies = countNewerReplies(root, read.SeenReplyAt)
		} else {
			item.UnseenReplies = root.ReplyCount
		}

		items = append(items, item)
		authorIDs[root.UserID] = struct{}{}
	}

	if err := s.resolveAuthors(ctx, client, items, authorIDs); err != nil {
		s.log.Warn("resolve search authors failed", "error", err)
	}

	s.writeJSON(w, http.StatusOK, sharedRiverResponse{Items: items})
	return nil
}
