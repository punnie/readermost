package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/config"
	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
	"github.com/punnie/readermost/internal/store"
)

func TestShareCardCarriesTheArticle(t *testing.T) {
	entry := &miniflux.Entry{
		Title:       "A [bracketed] title",
		URL:         "https://example.com/post",
		Author:      "Ada_Lovelace",
		PublishedAt: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC),
		ReadingTime: 7,
		Content:     `<p>Hello</p><img src="https://example.com/a.png?x=1&amp;y=2">`,
		Feed:        &miniflux.Feed{Title: "Example Blog", SiteURL: "https://example.com/"},
	}

	card := shareCard(entry, "An excerpt.", "https://reader.example.org/s/abc")

	if card.Title != "A [bracketed] title" || card.TitleLink != entry.URL {
		t.Errorf("title = %q → %q, want the article linked as-is", card.Title, card.TitleLink)
	}
	if card.AuthorName != "Example Blog" || card.AuthorLink != "https://example.com/" {
		t.Errorf("author = %q → %q, want the feed and its site", card.AuthorName, card.AuthorLink)
	}
	if !strings.Contains(card.Text, "An excerpt.") {
		t.Errorf("text %q lacks the excerpt", card.Text)
	}
	if !strings.Contains(card.Text, "[Discuss in Readermost](https://reader.example.org/s/abc)") {
		t.Errorf("text %q lacks the river link", card.Text)
	}
	if card.ThumbURL != "https://example.com/a.png?x=1&y=2" {
		t.Errorf("thumb = %q, want the first image with entities decoded", card.ThumbURL)
	}
	if !strings.Contains(card.Fallback, "Example Blog") || !strings.Contains(card.Fallback, entry.URL) {
		t.Errorf("fallback %q should name the feed and the URL", card.Fallback)
	}

	fields := map[string]string{}
	for _, field := range card.Fields {
		fields[field.Title] = field.Value
	}
	want := map[string]string{
		"Author":       `Ada\_Lovelace`,
		"Published":    "1 Sep 2026",
		"Reading time": "7 min",
	}
	for title, value := range want {
		if fields[title] != value {
			t.Errorf("field %q = %q, want %q", title, fields[title], value)
		}
	}
}

func TestShareCardLeavesOutWhatItLacks(t *testing.T) {
	entry := &miniflux.Entry{URL: "https://example.com/bare"}

	card := shareCard(entry, "", "https://reader.example.org/s/abc")

	if card.Title != entry.URL {
		t.Errorf("title = %q, want the URL when the entry has no title", card.Title)
	}
	if card.AuthorName != "" || card.ThumbURL != "" || len(card.Fields) != 0 {
		t.Errorf("card = %+v, want no feed, thumbnail or fields", card)
	}
	if card.Text != "[Discuss in Readermost](https://reader.example.org/s/abc)" {
		t.Errorf("text = %q, want only the river link", card.Text)
	}
}

func TestSafeMarkdownDefusesText(t *testing.T) {
	got := safeMarkdown("**bold** [x](http://evil) <b> @channel and @_here")

	for _, raw := range []string{"**", "[x]", "<b>", "@channel", "@_here", `@\_here`} {
		if strings.Contains(got, raw) {
			t.Errorf("safeMarkdown left %q in %q", raw, got)
		}
	}
}

func TestCardImage(t *testing.T) {
	cases := []struct {
		name  string
		entry *miniflux.Entry
		want  string
	}{
		{
			name: "enclosure wins over content",
			entry: &miniflux.Entry{
				Enclosures: []miniflux.Enclosure{
					{URL: "https://example.com/episode.mp3", MimeType: "audio/mpeg"},
					{URL: "https://example.com/cover.jpg", MimeType: "image/jpeg"},
				},
				Content: `<img src="https://example.com/inline.png">`,
			},
			want: "https://example.com/cover.jpg",
		},
		{
			name:  "relative image is useless to Mattermost",
			entry: &miniflux.Entry{Content: `<img src="/proxy/abc">`},
			want:  "",
		},
		{
			name:  "data URI is not a link",
			entry: &miniflux.Entry{Content: `<img alt="x" src='data:image/png;base64,AAAA'>`},
			want:  "",
		},
		{
			name:  "no image",
			entry: &miniflux.Entry{Content: `<p>words</p>`},
			want:  "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := cardImage(tc.entry); got != tc.want {
				t.Errorf("cardImage = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNoteFromMessage(t *testing.T) {
	cases := []struct {
		version int
		message string
		want    string
	}{
		{2, "  worth a read  ", "worth a read"},
		{2, "", ""},
		// A version 2 note is the whole message, blank lines and all.
		{2, "first\n\nsecond", "first\n\nsecond"},
		{1, "worth a read\n\n[Title](https://example.com) — Feed", "worth a read"},
		{1, "[Title](https://example.com) — Feed", ""},
	}
	for _, tc := range cases {
		if got := noteFromMessage(tc.version, tc.message); got != tc.want {
			t.Errorf("noteFromMessage(%d, %q) = %q, want %q", tc.version, tc.message, got, tc.want)
		}
	}
}

func TestLinkFromPostCarriesTheNote(t *testing.T) {
	post := postWithProps(t, "https://example.com/a", "my note")

	link := linkFromPost(post)
	if link == nil || link.Note == nil || *link.Note != "my note" {
		t.Fatalf("linkFromPost = %+v, want the message as the note", link)
	}

	pasted := linkFromPost(&mattermost.Post{Message: "https://example.com/b"})
	if pasted == nil || pasted.Note != nil {
		t.Fatalf("a pasted link should carry no note, got %+v", pasted)
	}
}

func newShareLinkServer(t *testing.T) (*Server, *store.Store, *store.User) {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	user := &store.User{
		MattermostUserID:    "mmuser000000000000000000001",
		MattermostUsername:  "punnie",
		MinifluxUserID:      2,
		MinifluxUsername:    "mm_x",
		MinifluxPasswordEnc: []byte("sealed"),
	}
	if err := db.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	cfg := &config.Config{PublicURL: "https://reader.example.org/"}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := New(cfg, auth.New(cfg, db, nil, nil, nil, logger), nil, nil, logger)
	return server, db, user
}

func followShareLink(t *testing.T, server *Server, path string, user *store.User) string {
	t.Helper()

	request := httptest.NewRequest(http.MethodGet, path, nil)
	if user != nil {
		request = request.WithContext(auth.WithIdentity(request.Context(), &auth.Identity{User: user}))
	}
	recorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusFound {
		t.Fatalf("GET %s = %d, want a redirect", path, recorder.Code)
	}
	return recorder.Header().Get("Location")
}

func TestShareLinkURL(t *testing.T) {
	server, _, _ := newShareLinkServer(t)
	if got := server.shareLinkURL("abc"); got != "https://reader.example.org/s/abc" {
		t.Errorf("shareLinkURL = %q", got)
	}
}

func TestShareLinkRedirects(t *testing.T) {
	server, db, user := newShareLinkServer(t)
	ctx := context.Background()

	if err := db.CreateShare(ctx, "posted", user.ID, "https://example.com/a"); err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if err := db.AttachSharePost(ctx, "posted", "post123"); err != nil {
		t.Fatalf("AttachSharePost: %v", err)
	}

	cases := []struct {
		name string
		path string
		user *store.User
		want string
	}{
		{"known share opens its post", "/s/posted", user, "/shared/post123"},
		{"unknown share lands on the river", "/s/nope", user, "/shared"},
		{"malformed id lands on the river", "/s/not%20an%20id", user, "/shared"},
		{"signed out goes to login and back", "/s/posted", nil, "/auth/login?return=%2Fs%2Fposted"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := followShareLink(t, server, tc.path, tc.user); got != tc.want {
				t.Errorf("Location = %q, want %q", got, tc.want)
			}
		})
	}
}
