package api

import (
	"testing"

	"github.com/punnie/readermost/internal/mattermost"
)

func postWithProps(t *testing.T, entryURL, message string) *mattermost.Post {
	t.Helper()
	post := &mattermost.Post{Message: message}
	if entryURL != "" {
		if err := post.SetSharedLink(&mattermost.SharedLink{
			Version:  mattermost.SharePropsVersion,
			EntryURL: entryURL,
		}); err != nil {
			t.Fatalf("SetSharedLink: %v", err)
		}
	}
	return post
}

func TestShareURLOfPrefersProps(t *testing.T) {
	// The message also contains a URL; props must win, because the message may
	// carry several links while props names the article that was shared.
	post := postWithProps(t, "https://example.com/real",
		"see also https://example.com/decoy\n\n[Title](https://example.com/real)")

	if got := shareURLOf(post); got != "https://example.com/real" {
		t.Errorf("shareURLOf = %q, want the props URL", got)
	}
}

func TestShareURLOfFallsBackToMessage(t *testing.T) {
	// A link pasted straight into Mattermost has no props at all.
	post := &mattermost.Post{Message: "worth a read: https://example.com/pasted"}

	if got := shareURLOf(post); got != "https://example.com/pasted" {
		t.Errorf("shareURLOf = %q, want the pasted URL", got)
	}
}

func TestShareURLOfTrimsTrailingPunctuation(t *testing.T) {
	post := &mattermost.Post{Message: "read https://example.com/article."}

	if got := shareURLOf(post); got != "https://example.com/article" {
		t.Errorf("shareURLOf = %q, want the trailing period removed", got)
	}
}

func TestShareURLOfIgnoresPostsWithoutLinks(t *testing.T) {
	post := &mattermost.Post{Message: "just chatting, no link here"}

	if got := shareURLOf(post); got != "" {
		t.Errorf("shareURLOf = %q, want empty", got)
	}
}

func TestNoteShareKeepsOldest(t *testing.T) {
	server := &Server{}
	const url = "https://example.com/article"

	// Arrival order is deliberately newest-first: the index must not simply
	// keep whatever it saw last.
	server.noteShare(url, &shareRecord{PostID: "newer", CreateAt: 200})
	server.noteShare(url, &shareRecord{PostID: "older", CreateAt: 100})

	got := server.shares.byURL[url]
	if got == nil {
		t.Fatal("noteShare recorded nothing")
	}
	if got.PostID != "older" {
		t.Errorf("index kept %q, want the oldest share so everyone lands on one thread", got.PostID)
	}
}

func TestNoteShareRecordsFirstSighting(t *testing.T) {
	server := &Server{}
	server.noteShare("https://example.com/a", &shareRecord{PostID: "p1", CreateAt: 10})

	if got := server.shares.byURL["https://example.com/a"]; got == nil || got.PostID != "p1" {
		t.Errorf("index = %+v, want the share just recorded", got)
	}
}
