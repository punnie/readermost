package store

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) (*Store, int64) {
	t.Helper()

	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	user := &User{
		MattermostUserID:    "mmuser000000000000000000001",
		MattermostUsername:  "punnie",
		MinifluxUserID:      2,
		MinifluxUsername:    "mm_x",
		MinifluxPasswordEnc: []byte("sealed"),
	}
	if err := db.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return db, user.ID
}

func TestRiverUnreadUntilRead(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	reads, err := db.RiverReads(ctx, userID)
	if err != nil {
		t.Fatalf("RiverReads: %v", err)
	}
	if len(reads) != 0 {
		t.Fatalf("a fresh user has %d read records, want none", len(reads))
	}

	if err := db.MarkRiverRead(ctx, userID, "post1", 500); err != nil {
		t.Fatalf("MarkRiverRead: %v", err)
	}

	reads, err = db.RiverReads(ctx, userID)
	if err != nil {
		t.Fatalf("RiverReads: %v", err)
	}
	read, ok := reads["post1"]
	if !ok {
		t.Fatal("post1 is not marked read")
	}
	if read.SeenReplyAt != 500 {
		t.Errorf("seen_reply_at = %d, want 500", read.SeenReplyAt)
	}
	if read.ReadAt == 0 {
		t.Error("read_at was not set")
	}
}

func TestMarkRiverReadMovesSeenReplyForward(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	if err := db.MarkRiverRead(ctx, userID, "post1", 500); err != nil {
		t.Fatalf("MarkRiverRead: %v", err)
	}
	// Re-reading after new comments must clear the badge.
	if err := db.MarkRiverRead(ctx, userID, "post1", 900); err != nil {
		t.Fatalf("MarkRiverRead: %v", err)
	}

	reads, _ := db.RiverReads(ctx, userID)
	if got := reads["post1"].SeenReplyAt; got != 900 {
		t.Errorf("seen_reply_at = %d, want 900", got)
	}
}

func TestMarkRiverReadNeverMovesSeenReplyBackward(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	if err := db.MarkRiverRead(ctx, userID, "post1", 900); err != nil {
		t.Fatalf("MarkRiverRead: %v", err)
	}
	// A stale snapshot must not resurrect a badge the reader already cleared.
	if err := db.MarkRiverRead(ctx, userID, "post1", 100); err != nil {
		t.Fatalf("MarkRiverRead: %v", err)
	}

	reads, _ := db.RiverReads(ctx, userID)
	if got := reads["post1"].SeenReplyAt; got != 900 {
		t.Errorf("seen_reply_at = %d, want it to stay at 900", got)
	}
}

func TestMarkRiverUnread(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	if err := db.MarkRiverRead(ctx, userID, "post1", 0); err != nil {
		t.Fatalf("MarkRiverRead: %v", err)
	}
	if err := db.MarkRiverUnread(ctx, userID, "post1"); err != nil {
		t.Fatalf("MarkRiverUnread: %v", err)
	}

	reads, _ := db.RiverReads(ctx, userID)
	if _, ok := reads["post1"]; ok {
		t.Error("post1 is still marked read after MarkRiverUnread")
	}
}

func TestMarkRiverReadBatch(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	seen := map[string]int64{"a": 1, "b": 2, "c": 3}
	if err := db.MarkRiverReadBatch(ctx, userID, seen); err != nil {
		t.Fatalf("MarkRiverReadBatch: %v", err)
	}

	reads, _ := db.RiverReads(ctx, userID)
	if len(reads) != 3 {
		t.Fatalf("marked %d items read, want 3", len(reads))
	}
	if reads["c"].SeenReplyAt != 3 {
		t.Errorf("seen_reply_at for c = %d, want 3", reads["c"].SeenReplyAt)
	}

	// An empty batch is a no-op, not an error: "mark all read" on an empty
	// river is a perfectly ordinary thing to do.
	if err := db.MarkRiverReadBatch(ctx, userID, nil); err != nil {
		t.Errorf("empty MarkRiverReadBatch: %v", err)
	}
}

func TestRiverReadsAreScopedToOneUser(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	other := &User{
		MattermostUserID:    "mmuser000000000000000000002",
		MattermostUsername:  "friend",
		MinifluxUserID:      3,
		MinifluxUsername:    "mm_y",
		MinifluxPasswordEnc: []byte("sealed"),
	}
	if err := db.CreateUser(ctx, other); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if err := db.MarkRiverRead(ctx, userID, "post1", 0); err != nil {
		t.Fatalf("MarkRiverRead: %v", err)
	}

	reads, _ := db.RiverReads(ctx, other.ID)
	if len(reads) != 0 {
		t.Error("one user's read state leaked into another's river")
	}
}

func TestSharedContentRoundTrip(t *testing.T) {
	db, _ := newTestStore(t)
	ctx := context.Background()

	content := &SharedContent{
		URL:         "go.dev/blog/x",
		Title:       "Generic Methods",
		FeedTitle:   "The Go Blog",
		FeedURL:     "https://go.dev/blog/feed.atom",
		Content:     "<p>Hello</p>",
		ReadingTime: 4,
	}
	if err := db.PutSharedContent(ctx, content); err != nil {
		t.Fatalf("PutSharedContent: %v", err)
	}

	got, err := db.SharedContentByURL(ctx, "go.dev/blog/x")
	if err != nil {
		t.Fatalf("SharedContentByURL: %v", err)
	}
	if got.Content != "<p>Hello</p>" || got.Title != "Generic Methods" {
		t.Errorf("round trip = %+v", got)
	}
	if got.ReadingTime != 4 {
		t.Errorf("reading_time = %d, want 4", got.ReadingTime)
	}
}

func TestSharedContentKeepsKnownFeedURL(t *testing.T) {
	db, _ := newTestStore(t)
	ctx := context.Background()

	if err := db.PutSharedContent(ctx, &SharedContent{
		URL: "go.dev/blog/x", Content: "<p>a</p>", FeedURL: "https://go.dev/blog/feed.atom",
	}); err != nil {
		t.Fatalf("PutSharedContent: %v", err)
	}

	// A later writer that does not know the feed URL must not erase it: the
	// Subscribe button depends on it.
	if err := db.PutSharedContent(ctx, &SharedContent{
		URL: "go.dev/blog/x", Content: "<p>b</p>",
	}); err != nil {
		t.Fatalf("PutSharedContent: %v", err)
	}

	got, err := db.SharedContentByURL(ctx, "go.dev/blog/x")
	if err != nil {
		t.Fatalf("SharedContentByURL: %v", err)
	}
	if got.FeedURL != "https://go.dev/blog/feed.atom" {
		t.Errorf("feed_url = %q, want it preserved", got.FeedURL)
	}
	if got.Content != "<p>b</p>" {
		t.Errorf("content = %q, want the newer text", got.Content)
	}
}

func TestSharedContentSkipsOversizedArticles(t *testing.T) {
	db, _ := newTestStore(t)
	ctx := context.Background()

	huge := strings.Repeat("x", MaxContentBytes+1)
	if err := db.PutSharedContent(ctx, &SharedContent{URL: "big", Content: huge}); err != nil {
		t.Fatalf("PutSharedContent: %v", err)
	}

	// Skipped, not stored, and not an error — caching is opportunistic.
	if _, err := db.SharedContentByURL(ctx, "big"); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound for an oversized article", err)
	}
}

func TestSharedContentIgnoresEmptyWrites(t *testing.T) {
	db, _ := newTestStore(t)
	ctx := context.Background()

	if err := db.PutSharedContent(ctx, &SharedContent{URL: "x", Content: ""}); err != nil {
		t.Fatalf("PutSharedContent: %v", err)
	}
	if _, err := db.SharedContentByURL(ctx, "x"); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound when there was nothing to store", err)
	}
}

func TestFeedURLForArticle(t *testing.T) {
	db, _ := newTestStore(t)
	ctx := context.Background()

	if err := db.PutSharedContent(ctx, &SharedContent{
		URL: "a", Content: "<p>a</p>", FeedURL: "https://example.com/feed.xml",
	}); err != nil {
		t.Fatalf("PutSharedContent: %v", err)
	}
	if err := db.PutSharedContent(ctx, &SharedContent{URL: "b", Content: "<p>b</p>"}); err != nil {
		t.Fatalf("PutSharedContent: %v", err)
	}

	if got, err := db.FeedURLForArticle(ctx, "a"); err != nil || got != "https://example.com/feed.xml" {
		t.Errorf("FeedURLForArticle(a) = %q, %v", got, err)
	}
	if _, err := db.FeedURLForArticle(ctx, "b"); err != ErrNotFound {
		t.Errorf("FeedURLForArticle(b) err = %v, want ErrNotFound", err)
	}
}
