package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
)

// urlPattern finds the first link in a post written by hand in Mattermost, so
// links pasted straight into the channel still become river items.
var urlPattern = regexp.MustCompile(`https?://[^\s<>"'\x60)\]]+`)

type sharedAuthor struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

type sharedLink struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	FeedTitle   string `json:"feed_title,omitempty"`
	FeedURL     string `json:"feed_url,omitempty"`
	FeedSiteURL string `json:"feed_site_url,omitempty"`
	Author      string `json:"author,omitempty"`
	PublishedAt string `json:"published_at,omitempty"`
	Excerpt     string `json:"excerpt,omitempty"`
	// FromReadermost distinguishes a rich share from a bare pasted URL.
	FromReadermost bool `json:"from_readermost"`
}

type sharedItem struct {
	PostID     string       `json:"post_id"`
	CreatedAt  int64        `json:"created_at"`
	Message    string       `json:"message"`
	ReplyCount int          `json:"reply_count"`
	Author     sharedAuthor `json:"author"`
	Link       *sharedLink  `json:"link,omitempty"`
	Permalink  string       `json:"permalink"`

	// Read state is Readermost's own: Miniflux knows nothing about the river.
	Read          bool `json:"read"`
	UnseenReplies int  `json:"unseen_replies"`
}

type sharedRiverResponse struct {
	Items  []sharedItem `json:"items"`
	Unread int          `json:"unread"`
}

// handleSharedRiver lists the shared channel as articles, annotated with this
// reader's read state.
func (s *Server) handleSharedRiver(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	ctx := r.Context()
	client := identity.Mattermost(s.mm)

	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 || value > 500 {
			return errBadRequest("limit must be between 1 and 500")
		}
		limit = value
	}

	snapshot, err := s.snapshot(ctx, client)
	if err != nil {
		return err
	}

	reads, err := s.store().RiverReads(ctx, identity.User.ID)
	if err != nil {
		return err
	}

	roots := snapshot.roots
	if len(roots) > limit {
		roots = roots[:limit]
	}

	items := make([]sharedItem, 0, len(roots))
	authorIDs := make(map[string]struct{}, len(roots))
	unread := 0

	for _, root := range roots {
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
			// Reading is permanent; new comments show as a badge instead of
			// putting the item back in bold.
			item.UnseenReplies = countNewerReplies(root, read.SeenReplyAt)
		} else {
			item.UnseenReplies = root.ReplyCount
			unread++
		}

		items = append(items, item)
		authorIDs[root.UserID] = struct{}{}
	}

	if err := s.resolveAuthors(ctx, client, items, authorIDs); err != nil {
		// Names are cosmetic; the river is still useful without them.
		s.log.Warn("resolve post authors failed", "error", err)
	}

	s.writeJSON(w, http.StatusOK, sharedRiverResponse{Items: items, Unread: unread})
	return nil
}

// countNewerReplies estimates how many replies arrived after the reader last
// looked.
//
// The snapshot keeps a reply count and the newest reply's timestamp, not every
// timestamp — so when the newest reply predates the last visit there is nothing
// new, and otherwise at least one reply is. Keeping per-reply timestamps for
// every thread would cost far more than the badge is worth.
func countNewerReplies(root *rootPost, seenReplyAt int64) int {
	if root.ReplyCount == 0 || root.LastReplyAt <= seenReplyAt {
		return 0
	}
	if seenReplyAt == 0 {
		return root.ReplyCount
	}
	return 1
}

// linkFromPost prefers Readermost's own metadata and falls back to the first URL
// in the message text. A post with neither is chat, not a shared article.
func linkFromPost(post *mattermost.Post) *sharedLink {
	if shared, ok := post.SharedLink(); ok {
		return &sharedLink{
			URL:            shared.EntryURL,
			Title:          shared.Title,
			FeedTitle:      shared.FeedTitle,
			FeedURL:        shared.FeedURL,
			FeedSiteURL:    shared.FeedSiteURL,
			Author:         shared.Author,
			PublishedAt:    shared.PublishedAt,
			Excerpt:        shared.Excerpt,
			FromReadermost: true,
		}
	}

	found := urlPattern.FindString(post.Message)
	if found == "" {
		return nil
	}
	// Markdown and prose routinely leave punctuation glued to a URL.
	found = strings.TrimRight(found, ".,;:!?")
	return &sharedLink{URL: found, Title: found}
}

func (s *Server) resolveAuthors(ctx context.Context, client *mattermost.Client, items []sharedItem, ids map[string]struct{}) error {
	if len(ids) == 0 {
		return nil
	}
	list := make([]string, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}

	users, err := client.UsersByIDs(ctx, list)
	if err != nil {
		return err
	}

	byID := make(map[string]*mattermost.User, len(users))
	for _, user := range users {
		byID[user.ID] = user
	}
	for i := range items {
		if user, ok := byID[items[i].Author.UserID]; ok {
			items[i].Author.Username = user.Username
			items[i].Author.DisplayName = user.DisplayName()
		}
	}
	return nil
}

type readRequest struct {
	Read *bool `json:"read,omitempty"`
}

// handleMarkRiverRead records that the reader has seen an item and its replies.
func (s *Server) handleMarkRiverRead(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	postID := r.PathValue("id")
	if postID == "" {
		return errBadRequest("post id is required")
	}

	var request readRequest
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &request); err != nil {
			return err
		}
	}

	ctx := r.Context()

	if request.Read != nil && !*request.Read {
		if err := s.store().MarkRiverUnread(ctx, identity.User.ID, postID); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}

	// Seeing the item means seeing the replies it currently has.
	var seenReplyAt int64
	if snapshot, err := s.snapshot(ctx, identity.Mattermost(s.mm)); err == nil {
		if root := snapshot.find(postID); root != nil {
			seenReplyAt = root.LastReplyAt
		}
	}

	if err := s.store().MarkRiverRead(ctx, identity.User.ID, postID, seenReplyAt); err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

// handleMarkRiverReadAll clears the whole river.
func (s *Server) handleMarkRiverReadAll(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	ctx := r.Context()

	snapshot, err := s.snapshot(ctx, identity.Mattermost(s.mm))
	if err != nil {
		return err
	}

	seen := make(map[string]int64, len(snapshot.roots))
	for _, root := range snapshot.roots {
		seen[root.PostID] = root.LastReplyAt
	}

	if err := s.store().MarkRiverReadBatch(ctx, identity.User.ID, seen); err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

type lookupResponse struct {
	Shared      bool          `json:"shared"`
	PostID      string        `json:"post_id,omitempty"`
	ReplyCount  int           `json:"reply_count,omitempty"`
	Permalink   string        `json:"permalink,omitempty"`
	CreatedAt   int64         `json:"created_at,omitempty"`
	Author      *sharedAuthor `json:"author,omitempty"`
	MineAlready bool          `json:"mine_already,omitempty"`
}

// handleLookupShare answers "has this article already been shared?".
func (s *Server) handleLookupShare(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	entryURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if entryURL == "" {
		return errBadRequest("url is required")
	}

	ctx := r.Context()
	client := identity.Mattermost(s.mm)

	snapshot, err := s.snapshot(ctx, client)
	if err != nil {
		return err
	}

	root := snapshot.shareOf(entryURL)
	if root == nil {
		s.writeJSON(w, http.StatusOK, lookupResponse{Shared: false})
		return nil
	}

	response := lookupResponse{
		Shared:      true,
		PostID:      root.PostID,
		ReplyCount:  root.ReplyCount,
		CreatedAt:   root.CreateAt,
		Permalink:   s.mm.BaseURL() + "/_redirect/pl/" + root.PostID,
		Author:      &sharedAuthor{UserID: root.UserID},
		MineAlready: root.UserID == identity.User.MattermostUserID,
	}

	if users, err := client.UsersByIDs(ctx, []string{root.UserID}); err == nil && len(users) > 0 {
		response.Author.Username = users[0].Username
		response.Author.DisplayName = users[0].DisplayName()
	}

	s.writeJSON(w, http.StatusOK, response)
	return nil
}

type shareRequest struct {
	EntryID int64  `json:"entry_id"`
	Message string `json:"message"`
}

// handleShare posts an entry into the shared channel as the user.
func (s *Server) handleShare(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	var request shareRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	if request.EntryID <= 0 {
		return errBadRequest("entry_id is required")
	}

	ctx := r.Context()

	var entry *miniflux.Entry
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		entry, err = client.Entry(ctx, request.EntryID)
		return err
	})
	if err != nil {
		return err
	}
	if entry.URL == "" {
		return errBadRequest("this entry has no link to share")
	}

	// Refuse a second copy from the same person. The UI already turns the
	// button into "Discuss" once something is shared, but a double-click or a
	// second tab would otherwise still post twice.
	//
	// Only the same author is blocked: two people independently finding the
	// same article is a normal thing to want to say something about.
	if snapshot, err := s.snapshot(ctx, identity.Mattermost(s.mm)); err != nil {
		s.log.Warn("duplicate share check failed", "error", err)
	} else if existing := snapshot.shareOf(entry.URL); existing != nil &&
		existing.UserID == identity.User.MattermostUserID {
		s.writeJSON(w, http.StatusConflict, map[string]any{
			"error":     "you have already shared this article",
			"post_id":   existing.PostID,
			"permalink": s.mm.BaseURL() + "/_redirect/pl/" + existing.PostID,
		})
		return nil
	}

	post := &mattermost.Post{
		ChannelID: s.cfg.Mattermost.SharedChannelID,
		Message:   shareMessage(request.Message, entry),
	}

	link := &mattermost.SharedLink{
		Version:  mattermost.SharePropsVersion,
		EntryURL: entry.URL,
		Title:    entry.Title,
		Author:   entry.Author,
		Excerpt:  excerptFrom(entry.Content),
	}
	if !entry.PublishedAt.IsZero() {
		link.PublishedAt = entry.PublishedAt.UTC().Format(time.RFC3339)
	}
	if entry.Feed != nil {
		link.FeedTitle = entry.Feed.Title
		// The feed URL, not just the site: it is what lets a reader subscribe
		// straight from the river.
		link.FeedURL = entry.Feed.FeedURL
		link.FeedSiteURL = entry.Feed.SiteURL
	}
	if err := post.SetSharedLink(link); err != nil {
		return err
	}

	created, err := identity.Mattermost(s.mm).CreatePost(ctx, post)
	if err != nil {
		return err
	}

	// The sharer has the full text; copy it so readers without this feed can
	// still read the article.
	s.cacheEntry(ctx, entry.URL, entry)

	// Your own share should never come back to you as unread.
	if err := s.store().MarkRiverRead(ctx, identity.User.ID, created.ID, 0); err != nil {
		s.log.Warn("mark own share read failed", "error", err)
	}

	s.InvalidateChannel()

	s.writeJSON(w, http.StatusCreated, sharedItem{
		PostID:    created.ID,
		CreatedAt: created.CreateAt,
		Message:   created.Message,
		Read:      true,
		Author: sharedAuthor{
			UserID:      identity.User.MattermostUserID,
			Username:    identity.User.MattermostUsername,
			DisplayName: identity.User.MattermostUsername,
		},
		Permalink: s.mm.BaseURL() + "/_redirect/pl/" + created.ID,
		Link:      linkFromPost(created),
	})
	return nil
}

// shareMessage composes the post body: the sharer's note, then the article as a
// markdown link so Mattermost renders and previews it.
func shareMessage(note string, entry *miniflux.Entry) string {
	title := strings.TrimSpace(entry.Title)
	if title == "" {
		title = entry.URL
	}
	// Markdown link text must not contain unescaped brackets.
	title = strings.NewReplacer("[", "(", "]", ")").Replace(title)

	link := fmt.Sprintf("[%s](%s)", title, entry.URL)
	if entry.Feed != nil && entry.Feed.Title != "" {
		link += " — " + entry.Feed.Title
	}

	note = strings.TrimSpace(note)
	if note == "" {
		return link
	}
	return note + "\n\n" + link
}

type threadMessage struct {
	PostID    string       `json:"post_id"`
	CreatedAt int64        `json:"created_at"`
	Message   string       `json:"message"`
	Author    sharedAuthor `json:"author"`
	IsRoot    bool         `json:"is_root"`
}

// handleThread returns a shared link's comment thread.
func (s *Server) handleThread(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	postID := r.PathValue("id")
	if postID == "" {
		return errBadRequest("post id is required")
	}

	ctx := r.Context()
	client := identity.Mattermost(s.mm)

	list, err := client.PostThread(ctx, postID)
	if err != nil {
		return err
	}

	posts := list.Ordered()
	sortPostsByCreatedAt(posts)

	messages := make([]threadMessage, 0, len(posts))
	authorIDs := make(map[string]struct{}, len(posts))

	for _, post := range posts {
		if post.DeleteAt != 0 || post.IsSystemMessage() {
			continue
		}
		// Scope to the configured channel: a post ID from anywhere else in
		// Mattermost is not this app's business, even if the user can read it.
		if post.ChannelID != s.cfg.Mattermost.SharedChannelID {
			return errBadRequest("that post is not in the shared channel")
		}

		messages = append(messages, threadMessage{
			PostID:    post.ID,
			CreatedAt: post.CreateAt,
			Message:   post.Message,
			Author:    sharedAuthor{UserID: post.UserID},
			IsRoot:    post.RootID == "",
		})
		authorIDs[post.UserID] = struct{}{}
	}

	if err := s.resolveThreadAuthors(ctx, client, messages, authorIDs); err != nil {
		s.log.Warn("resolve thread authors failed", "error", err)
	}

	s.writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
	return nil
}

type commentRequest struct {
	Message string `json:"message"`
}

// handleComment replies in a shared link's thread, as the user.
func (s *Server) handleComment(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	postID := r.PathValue("id")
	if postID == "" {
		return errBadRequest("post id is required")
	}

	var request commentRequest
	if err := decodeJSON(r, &request); err != nil {
		return err
	}
	message := strings.TrimSpace(request.Message)
	if message == "" {
		return errBadRequest("message is required")
	}

	ctx := r.Context()
	client := identity.Mattermost(s.mm)

	// Verify the root post is in the shared channel before replying, so this
	// endpoint cannot be used to post into arbitrary channels.
	root, err := client.Post(ctx, postID)
	if err != nil {
		return err
	}
	if root.ChannelID != s.cfg.Mattermost.SharedChannelID {
		return errBadRequest("that post is not in the shared channel")
	}
	// Replying to a reply should still land on the thread root.
	rootID := root.ID
	if root.RootID != "" {
		rootID = root.RootID
	}

	created, err := client.CreatePost(ctx, &mattermost.Post{
		ChannelID: s.cfg.Mattermost.SharedChannelID,
		RootID:    rootID,
		Message:   message,
	})
	if err != nil {
		return err
	}

	// You have seen your own comment, so it must not come back as a badge.
	if err := s.store().MarkRiverRead(ctx, identity.User.ID, rootID, created.CreateAt); err != nil {
		s.log.Warn("mark thread read failed", "error", err)
	}

	s.InvalidateChannel()

	s.writeJSON(w, http.StatusCreated, threadMessage{
		PostID:    created.ID,
		CreatedAt: created.CreateAt,
		Message:   created.Message,
		Author: sharedAuthor{
			UserID:      identity.User.MattermostUserID,
			Username:    identity.User.MattermostUsername,
			DisplayName: identity.User.MattermostUsername,
		},
	})
	return nil
}

func (s *Server) resolveThreadAuthors(ctx context.Context, client *mattermost.Client, messages []threadMessage, ids map[string]struct{}) error {
	if len(ids) == 0 {
		return nil
	}
	list := make([]string, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}

	users, err := client.UsersByIDs(ctx, list)
	if err != nil {
		return err
	}

	byID := make(map[string]*mattermost.User, len(users))
	for _, user := range users {
		byID[user.ID] = user
	}
	for i := range messages {
		if user, ok := byID[messages[i].Author.UserID]; ok {
			messages[i].Author.Username = user.Username
			messages[i].Author.DisplayName = user.DisplayName()
		}
	}
	return nil
}

func sortPostsByCreatedAt(posts []*mattermost.Post) {
	sort.Slice(posts, func(i, j int) bool {
		return posts[i].CreateAt < posts[j].CreateAt
	})
}
