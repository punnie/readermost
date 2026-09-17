package api

import (
	"strings"
	"testing"
)

func TestFoldStripsAccents(t *testing.T) {
	cases := map[string]string{
		"Política":    "politica",
		"Público":     "publico",
		"Expressão":   "expressao",
		"Économie":    "economie",
		"The Go Blog": "the go blog",
	}
	for input, want := range cases {
		if got := fold(input); got != want {
			t.Errorf("fold(%q) = %q, want %q", input, got, want)
		}
	}

	// The point of folding: both sides land on the same string.
	if fold("politica") != fold("Política") {
		t.Error("an unaccented query does not fold to the same text as an accented title")
	}
}

func sharedPost(title, feedTitle, excerpt, message string) *rootPost {
	return &rootPost{
		Message: message,
		Link: &sharedLink{
			Title:     title,
			FeedTitle: feedTitle,
			Excerpt:   excerpt,
		},
	}
}

func terms(query string) []string {
	return strings.Fields(fold(query))
}

func TestMatchesSharedFieldsSearched(t *testing.T) {
	post := sharedPost("Goroutine Leak Profiles", "The Go Blog", "a way to find leaks", "worth reading")

	for _, query := range []string{"goroutine", "go blog", "leaks", "worth reading"} {
		if !matchesShared(post, terms(query)) {
			t.Errorf("%q did not match, but title, feed, excerpt and message are all searched", query)
		}
	}

	if matchesShared(post, terms("kubernetes")) {
		t.Error("matched a term that appears nowhere")
	}
}

func TestMatchesSharedIgnoresAccents(t *testing.T) {
	post := sharedPost("Política e economia", "Público", "", "")

	// The reason this search exists separately from Miniflux's.
	for _, query := range []string{"politica", "publico", "POLITICA", "Política"} {
		if !matchesShared(post, terms(query)) {
			t.Errorf("%q did not match an accented title", query)
		}
	}
}

func TestMatchesSharedAndsTerms(t *testing.T) {
	post := sharedPost("Goroutine Leak Profiles", "The Go Blog", "", "")

	if !matchesShared(post, terms("goroutine profiles")) {
		t.Error("both terms are present; it should match")
	}
	// Miniflux ANDs a multi-word article search, so this half must agree.
	if matchesShared(post, terms("goroutine kubernetes")) {
		t.Error("one term is absent; ANDing means no match")
	}
}

func TestMatchesSharedSkipsChat(t *testing.T) {
	// A post with no link is chat, not a shared article, and is not in the river.
	chat := &rootPost{Message: "anyone around?", Link: nil}
	if matchesShared(chat, terms("anyone")) {
		t.Error("a link-less message matched; it is not a river item")
	}
}

func TestMatchesSharedEmptyTermsMatchEverything(t *testing.T) {
	// Guarded by the handler, which returns early on an empty query; this just
	// pins the behaviour so the guard cannot quietly become load-bearing.
	post := sharedPost("Anything", "", "", "")
	if !matchesShared(post, nil) {
		t.Error("no terms should not exclude a post")
	}
}
