package api

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/punnie/readermost/internal/mattermost"
)

// The channel snapshot's reach and lifetime.
//
// Neither Mattermost nor Miniflux indexes URLs in search — verified against a
// live instance, where a full URL and a hyphenated slug both match nothing while
// the title matches. So every "has this been shared?" question is answered by
// scanning the channel and comparing, and one cached scan serves them all.
const (
	maxIndexPosts  = 600
	indexPageSize  = 200
	indexFreshness = 30 * time.Second
)

// rootPost is one shared link as the snapshot remembers it.
type rootPost struct {
	PostID      string
	UserID      string
	CreateAt    int64
	Message     string
	Link        *sharedLink
	ReplyCount  int
	LastReplyAt int64
}

// channelSnapshot is the shared channel, as far back as maxIndexPosts.
//
// Every river feature reads from it: the list, the Discuss lookup, the
// duplicate-share guard and the unseen-comment badges. Having one source is
// what keeps their reply counts agreeing with each other.
type channelSnapshot struct {
	mu      sync.Mutex
	builtAt time.Time
	roots   []*rootPost          // newest first, link-bearing only
	byURL   map[string]*rootPost // normalised URL → oldest share of it
}

// Invalidate forces the next read to rebuild. Called when a post lands in the
// channel, whether from this app or from Mattermost itself.
func (s *Server) InvalidateChannel() {
	s.channel.mu.Lock()
	defer s.channel.mu.Unlock()
	s.channel.builtAt = time.Time{}
}

// snapshot returns the current channel view, rebuilding it if stale.
func (s *Server) snapshot(ctx context.Context, client *mattermost.Client) (*channelSnapshot, error) {
	s.channel.mu.Lock()
	defer s.channel.mu.Unlock()

	if time.Since(s.channel.builtAt) <= indexFreshness && s.channel.roots != nil {
		return &s.channel, nil
	}

	roots, byURL, err := s.scanChannel(ctx, client)
	if err != nil {
		// Serve a stale snapshot rather than failing the river outright: an
		// out-of-date list beats an error page.
		if s.channel.roots != nil {
			s.log.Warn("channel scan failed, serving stale snapshot", "error", err)
			return &s.channel, nil
		}
		return nil, err
	}

	s.channel.roots = roots
	s.channel.byURL = byURL
	s.channel.builtAt = time.Now()
	return &s.channel, nil
}

// scanChannel walks the channel and builds the snapshot's two views of it.
func (s *Server) scanChannel(ctx context.Context, client *mattermost.Client) ([]*rootPost, map[string]*rootPost, error) {
	type replyStats struct {
		count int
		last  int64
	}

	posts := make(map[string]*mattermost.Post)
	replies := make(map[string]*replyStats)

	before := ""
	for scanned := 0; scanned < maxIndexPosts; scanned += indexPageSize {
		list, err := client.ChannelPosts(ctx, s.cfg.Mattermost.SharedChannelID,
			mattermost.ChannelPostOptions{PerPage: indexPageSize, Before: before})
		if err != nil {
			return nil, nil, err
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
				stats, ok := replies[post.RootID]
				if !ok {
					stats = &replyStats{}
					replies[post.RootID] = stats
				}
				stats.count++
				if post.CreateAt > stats.last {
					stats.last = post.CreateAt
				}
				continue
			}
			posts[post.ID] = post
		}

		before = ordered[len(ordered)-1].ID
		if len(ordered) < indexPageSize {
			break
		}
	}

	roots := make([]*rootPost, 0, len(posts))
	byURL := make(map[string]*rootPost, len(posts))

	for _, post := range posts {
		link := linkFromPost(post)
		// A message with no link is chat, not a shared article. It stays in the
		// channel and in its thread; it just is not a river item.
		if link == nil {
			continue
		}

		root := &rootPost{
			PostID:   post.ID,
			UserID:   post.UserID,
			CreateAt: post.CreateAt,
			Message:  post.Message,
			Link:     link,
		}
		if stats, ok := replies[post.ID]; ok {
			root.ReplyCount = stats.count
			root.LastReplyAt = stats.last
		}

		roots = append(roots, root)

		// Oldest wins: the first person to share something owns the thread, so
		// everyone converges on one discussion.
		key := normaliseURL(link.URL)
		if existing, ok := byURL[key]; !ok || root.CreateAt < existing.CreateAt {
			byURL[key] = root
		}
	}

	sort.Slice(roots, func(i, j int) bool {
		return roots[i].CreateAt > roots[j].CreateAt
	})
	return roots, byURL, nil
}

// find returns the snapshot's record of one post.
func (c *channelSnapshot) find(postID string) *rootPost {
	for _, root := range c.roots {
		if root.PostID == postID {
			return root
		}
	}
	return nil
}

// shareOf returns the discussion for an article URL, if there is one.
func (c *channelSnapshot) shareOf(entryURL string) *rootPost {
	return c.byURL[normaliseURL(entryURL)]
}

// normaliseURL makes URL comparison forgiving of the differences that do not
// change which article is meant.
func normaliseURL(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	trimmed = strings.TrimSuffix(trimmed, "/")
	trimmed = strings.TrimPrefix(trimmed, "https://")
	trimmed = strings.TrimPrefix(trimmed, "http://")
	return strings.TrimPrefix(trimmed, "www.")
}
