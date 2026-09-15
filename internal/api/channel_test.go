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
			Title:    "A Title",
		}); err != nil {
			t.Fatalf("SetSharedLink: %v", err)
		}
	}
	return post
}

func TestLinkFromPostPrefersProps(t *testing.T) {
	// The message also contains a URL; props must win, because the message may
	// carry several links while props names the article that was shared.
	post := postWithProps(t, "https://example.com/real",
		"see also https://example.com/decoy\n\n[Title](https://example.com/real)")

	link := linkFromPost(post)
	if link == nil || link.URL != "https://example.com/real" {
		t.Fatalf("linkFromPost = %+v, want the props URL", link)
	}
	if !link.FromReadermost {
		t.Error("a props-bearing post should be marked as shared from Readermost")
	}
}

func TestLinkFromPostFallsBackToMessage(t *testing.T) {
	post := &mattermost.Post{Message: "worth a read: https://example.com/pasted"}

	link := linkFromPost(post)
	if link == nil || link.URL != "https://example.com/pasted" {
		t.Fatalf("linkFromPost = %+v, want the pasted URL", link)
	}
	if link.FromReadermost {
		t.Error("a hand-pasted link should not claim to come from Readermost")
	}
}

func TestLinkFromPostTrimsTrailingPunctuation(t *testing.T) {
	post := &mattermost.Post{Message: "read https://example.com/article."}

	if link := linkFromPost(post); link == nil || link.URL != "https://example.com/article" {
		t.Fatalf("linkFromPost = %+v, want the trailing period removed", link)
	}
}

func TestLinkFromPostIgnoresChat(t *testing.T) {
	// A message with no link is chat. It stays in the channel and in its
	// thread, but it is not a river item.
	post := &mattermost.Post{Message: "anyone around?"}

	if link := linkFromPost(post); link != nil {
		t.Errorf("linkFromPost = %+v, want nil for a link-less message", link)
	}
}

func TestNormaliseURL(t *testing.T) {
	same := [][2]string{
		{"https://go.dev/blog/x", "http://go.dev/blog/x"},
		{"https://go.dev/blog/x", "https://go.dev/blog/x/"},
		{"https://www.go.dev/blog/x", "https://go.dev/blog/x"},
		{"https://GO.dev/Blog/x", "https://go.dev/blog/x"},
		{"  https://go.dev/blog/x  ", "https://go.dev/blog/x"},
	}
	for _, pair := range same {
		if normaliseURL(pair[0]) != normaliseURL(pair[1]) {
			t.Errorf("normaliseURL(%q) != normaliseURL(%q)", pair[0], pair[1])
		}
	}

	different := [][2]string{
		{"https://go.dev/blog/x", "https://go.dev/blog/y"},
		{"https://go.dev/blog/x", "https://example.com/blog/x"},
	}
	for _, pair := range different {
		if normaliseURL(pair[0]) == normaliseURL(pair[1]) {
			t.Errorf("normaliseURL treated %q and %q as the same article", pair[0], pair[1])
		}
	}
}

func TestSnapshotShareOfMatchesAcrossURLVariants(t *testing.T) {
	root := &rootPost{PostID: "p1", CreateAt: 100}
	snapshot := &channelSnapshot{
		byURL: map[string]*rootPost{normaliseURL("https://go.dev/blog/x"): root},
	}

	// Whichever spelling the reader's own feed uses must find the discussion.
	for _, variant := range []string{
		"https://go.dev/blog/x",
		"http://go.dev/blog/x/",
		"https://www.go.dev/blog/x",
	} {
		if got := snapshot.shareOf(variant); got != root {
			t.Errorf("shareOf(%q) = %v, want the indexed root", variant, got)
		}
	}

	if got := snapshot.shareOf("https://go.dev/blog/other"); got != nil {
		t.Errorf("shareOf of an unshared URL = %v, want nil", got)
	}
}

func TestCountNewerReplies(t *testing.T) {
	tests := []struct {
		name        string
		root        *rootPost
		seenReplyAt int64
		want        int
	}{
		{
			name: "no replies at all",
			root: &rootPost{ReplyCount: 0},
			want: 0,
		},
		{
			name:        "never read, so every reply is new",
			root:        &rootPost{ReplyCount: 3, LastReplyAt: 500},
			seenReplyAt: 0,
			want:        3,
		},
		{
			name:        "read after the newest reply",
			root:        &rootPost{ReplyCount: 3, LastReplyAt: 500},
			seenReplyAt: 500,
			want:        0,
		},
		{
			name:        "a reply arrived after the last visit",
			root:        &rootPost{ReplyCount: 4, LastReplyAt: 900},
			seenReplyAt: 500,
			want:        1,
		},
	}

	for _, test := range tests {
		if got := countNewerReplies(test.root, test.seenReplyAt); got != test.want {
			t.Errorf("%s: countNewerReplies = %d, want %d", test.name, got, test.want)
		}
	}
}
