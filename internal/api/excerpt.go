package api

import (
	"html"
	"regexp"
	"strings"
	"unicode"
)

const excerptLimit = 320

var (
	// Entry content is HTML that Miniflux has already sanitised, but the river
	// wants plain text, so tags come out entirely.
	tagPattern         = regexp.MustCompile(`(?s)<[^>]*>`)
	scriptStylePattern = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	whitespacePattern  = regexp.MustCompile(`\s+`)

	// Tidies the space a stripped inline tag leaves in front of punctuation.
	// Only unambiguously-closing marks: a straight quote or apostrophe may well
	// be opening one, and eating the space before it reads worse than leaving it.
	spaceBeforePunctuation = regexp.MustCompile(` +([,.;:!?…”’)\]])`)
)

// excerptFrom turns entry HTML into a short plain-text preview, cut on a word
// boundary so it never ends mid-word.
func excerptFrom(content string) string {
	if content == "" {
		return ""
	}

	text := scriptStylePattern.ReplaceAllString(content, " ")
	// A space, not an empty string: "<p>one</p><p>two</p>" must not become
	// "onetwo". The cost is a stray space before punctuation when a tag closes
	// mid-sentence ("<strong>there</strong>,"), tidied up below.
	text = tagPattern.ReplaceAllString(text, " ")
	text = html.UnescapeString(text)
	text = whitespacePattern.ReplaceAllString(text, " ")
	text = spaceBeforePunctuation.ReplaceAllString(text, "$1")
	text = strings.TrimSpace(text)

	if len(text) <= excerptLimit {
		return text
	}

	// Cut at the last space before the limit, so the preview ends on a word.
	cut := text[:excerptLimit]
	if space := strings.LastIndexFunc(cut, unicode.IsSpace); space > excerptLimit/2 {
		cut = cut[:space]
	}
	return strings.TrimRight(cut, " ,;:.—-") + "…"
}
