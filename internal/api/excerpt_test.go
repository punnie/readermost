package api

import (
	"strings"
	"testing"
)

func TestExcerptStripsMarkup(t *testing.T) {
	got := excerptFrom(`<p>Hello <strong>there</strong>, friend.</p>`)
	if got != "Hello there, friend." {
		t.Errorf("excerptFrom = %q, want %q", got, "Hello there, friend.")
	}
}

func TestExcerptDropsScriptAndStyle(t *testing.T) {
	got := excerptFrom(`<style>p{color:red}</style><p>Visible</p><script>alert(1)</script>`)
	if strings.Contains(got, "color") || strings.Contains(got, "alert") {
		t.Errorf("excerptFrom leaked script or style content: %q", got)
	}
	if got != "Visible" {
		t.Errorf("excerptFrom = %q, want %q", got, "Visible")
	}
}

func TestExcerptUnescapesEntities(t *testing.T) {
	got := excerptFrom(`<p>Tom &amp; Jerry &mdash; &quot;classic&quot;</p>`)
	want := `Tom & Jerry — "classic"`
	if got != want {
		t.Errorf("excerptFrom = %q, want %q", got, want)
	}
}

func TestExcerptCollapsesWhitespace(t *testing.T) {
	got := excerptFrom("<p>one\n\n   two\t\tthree</p>")
	if got != "one two three" {
		t.Errorf("excerptFrom = %q, want %q", got, "one two three")
	}
}

func TestExcerptTruncatesOnWordBoundary(t *testing.T) {
	long := strings.Repeat("alpha beta gamma delta ", 60)

	got := excerptFrom("<p>" + long + "</p>")
	if len([]byte(got)) > excerptLimit+3 {
		t.Errorf("excerpt is %d bytes, want <= %d", len(got), excerptLimit+3)
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("truncated excerpt %q does not end with an ellipsis", got[len(got)-10:])
	}
	// A word-boundary cut means the text before the ellipsis is a whole word.
	trimmed := strings.TrimSuffix(got, "…")
	if strings.HasSuffix(trimmed, "alph") || strings.HasSuffix(trimmed, "gamm") {
		t.Errorf("excerpt was cut mid-word: %q", got)
	}
}

func TestExcerptHandlesEmptyAndTagOnly(t *testing.T) {
	if got := excerptFrom(""); got != "" {
		t.Errorf("excerptFrom(\"\") = %q, want empty", got)
	}
	if got := excerptFrom("<div><br/></div>"); got != "" {
		t.Errorf("excerptFrom of tag-only markup = %q, want empty", got)
	}
}
