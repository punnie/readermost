package api

import (
	"strings"
	"testing"

	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
)

func shareEntry(title, feedTitle string) *miniflux.Entry {
	entry := &miniflux.Entry{Title: title, URL: "https://example.com/post"}
	if feedTitle != "" {
		entry.Feed = &miniflux.Feed{Title: feedTitle}
	}
	return entry
}

func TestShareMessageWithoutNote(t *testing.T) {
	got := shareMessage("  ", shareEntry("A Post", "Blog"), "https://reader.test/shared")
	want := "**[A Post](https://example.com/post)** · Blog · [Readermost ↗](https://reader.test/shared)"
	if got != want {
		t.Errorf("shareMessage =\n%q\nwant\n%q", got, want)
	}
}

func TestShareMessagePutsMarkedNoteAfterArticle(t *testing.T) {
	got := shareMessage(" worth it \n really ", shareEntry("A Post", "Blog"), "https://reader.test/shared")
	headline, note, found := strings.Cut(got, "\n\n")
	if !found {
		t.Fatalf("shareMessage = %q, want the note in its own paragraph", got)
	}
	// The article link must come first so Mattermost previews it, not the
	// backlink.
	if !strings.HasPrefix(headline, "**[A Post](https://example.com/post)**") {
		t.Errorf("headline = %q, want it to open with the article", headline)
	}
	if note != "💬 worth it \n really" {
		t.Errorf("note = %q, want it marked as a comment", note)
	}
}

func TestShareMessageEscapesTitles(t *testing.T) {
	got := shareMessage("", shareEntry("[Draft] Post", "*nix_news*"), "")
	want := "**[(Draft) Post](https://example.com/post)** · \\*nix\\_news\\*"
	if got != want {
		t.Errorf("shareMessage = %q, want %q", got, want)
	}
}

func TestShareMessageFallsBackToURL(t *testing.T) {
	got := shareMessage("", shareEntry("", ""), "")
	if got != "**[https://example.com/post](https://example.com/post)**" {
		t.Errorf("shareMessage = %q", got)
	}
}

func TestLinkFromPostReadsNoteFromProps(t *testing.T) {
	post := &mattermost.Post{Message: "**[A](https://example.com/a)**\n\n💬 hello"}
	if err := post.SetSharedLink(&mattermost.SharedLink{
		Version:  mattermost.SharePropsVersion,
		EntryURL: "https://example.com/a",
		Note:     "hello",
	}); err != nil {
		t.Fatalf("SetSharedLink: %v", err)
	}
	if link := linkFromPost(post); link == nil || link.Note != "hello" {
		t.Errorf("linkFromPost = %+v, want note from props", link)
	}
}

func TestLinkFromPostRecoversLegacyNote(t *testing.T) {
	post := &mattermost.Post{Message: "first\n\nsecond\n\n[A](https://example.com/a) — Blog"}
	if err := post.SetSharedLink(&mattermost.SharedLink{Version: 1, EntryURL: "https://example.com/a"}); err != nil {
		t.Fatalf("SetSharedLink: %v", err)
	}
	if link := linkFromPost(post); link == nil || link.Note != "first\n\nsecond" {
		t.Errorf("linkFromPost = %+v, want the legacy note", link)
	}

	bare := &mattermost.Post{Message: "[A](https://example.com/a)"}
	if err := bare.SetSharedLink(&mattermost.SharedLink{Version: 1, EntryURL: "https://example.com/a"}); err != nil {
		t.Fatalf("SetSharedLink: %v", err)
	}
	if link := linkFromPost(bare); link == nil || link.Note != "" {
		t.Errorf("linkFromPost = %+v, want no note", link)
	}
}
