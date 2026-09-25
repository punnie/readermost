package api

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
)

// cardColor is the stripe down the side of a share card: Readermost's theme
// colour, so shares are recognisable at a glance in the channel.
const cardColor = "#1a5fb4"

var (
	// imgSrcPattern finds the first image in entry HTML, for the card thumbnail.
	imgSrcPattern = regexp.MustCompile(`(?i)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']`)

	// markdownSpecial are the characters that would turn copied text into
	// formatting, links or HTML when Mattermost renders a card's markdown.
	markdownSpecial = strings.NewReplacer(
		`\`, `\\`, "`", "\\`", `*`, `\*`, `_`, `\_`,
		`[`, `\[`, `]`, `\]`, `<`, `\<`, `>`, `\>`,
		`~`, `\~`, `|`, `\|`, `#`, `\#`,
	)

	// mentionPattern is an @-mention as Mattermost recognises one. Text copied
	// from an article must never ping the channel.
	mentionPattern = regexp.MustCompile(`@([\p{L}\p{N}_.\-])`)
)

// shareCard is how a share looks in Mattermost: the feed, the article title
// linking to the original, a preview, the facts about it, and a way back into
// the river where the discussion lives alongside the full text.
func shareCard(entry *miniflux.Entry, excerpt, riverURL string) mattermost.Attachment {
	title := strings.TrimSpace(entry.Title)
	if title == "" {
		title = entry.URL
	}

	card := mattermost.Attachment{
		Fallback:  title,
		Color:     cardColor,
		Title:     title,
		TitleLink: entry.URL,
		ThumbURL:  cardImage(entry),
		Footer:    "Readermost",
	}

	if entry.Feed != nil && entry.Feed.Title != "" {
		card.AuthorName = entry.Feed.Title
		card.AuthorLink = httpURL(entry.Feed.SiteURL)
		card.Fallback += " — " + entry.Feed.Title
	}
	card.Fallback += " " + entry.URL

	var text []string
	if excerpt != "" {
		text = append(text, safeMarkdown(excerpt))
	}
	if riverURL != "" {
		text = append(text, fmt.Sprintf("[Discuss in Readermost](%s)", riverURL))
	}
	card.Text = strings.Join(text, "\n\n")

	if author := strings.TrimSpace(entry.Author); author != "" {
		card.Fields = append(card.Fields, mattermost.AttachmentField{
			Title: "Author", Value: safeMarkdown(author), Short: true,
		})
	}
	if !entry.PublishedAt.IsZero() {
		card.Fields = append(card.Fields, mattermost.AttachmentField{
			Title: "Published", Value: entry.PublishedAt.UTC().Format("2 Jan 2006"), Short: true,
		})
	}
	if entry.ReadingTime > 0 {
		card.Fields = append(card.Fields, mattermost.AttachmentField{
			Title: "Reading time", Value: fmt.Sprintf("%d min", entry.ReadingTime), Short: true,
		})
	}

	return card
}

// safeMarkdown makes plain text safe to drop into a card's markdown: it reads
// the same, but cannot format, link or mention anyone.
func safeMarkdown(text string) string {
	// A zero-width space after the @ keeps the text readable while stopping
	// Mattermost from treating it as a mention. It goes in before escaping, so
	// an escaped "@\_name" cannot slip past as "@_name".
	text = mentionPattern.ReplaceAllString(text, "@​$1")
	return markdownSpecial.Replace(text)
}

// cardImage picks a thumbnail: an image enclosure first, since the feed chose
// it deliberately, then the first image in the article. Only absolute http(s)
// URLs qualify — Mattermost fetches the image itself, so a relative path or a
// Miniflux proxy URL would lead nowhere.
func cardImage(entry *miniflux.Entry) string {
	for _, enclosure := range entry.Enclosures {
		if strings.HasPrefix(enclosure.MimeType, "image/") {
			if image := httpURL(enclosure.URL); image != "" {
				return image
			}
		}
	}
	if match := imgSrcPattern.FindStringSubmatch(entry.Content); match != nil {
		return httpURL(strings.ReplaceAll(match[1], "&amp;", "&"))
	}
	return ""
}

// httpURL returns raw if it is an absolute http(s) URL, and "" otherwise.
func httpURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return ""
	}
	return parsed.String()
}

// noteFromMessage recovers the sharer's own words from a Readermost post.
//
// From version 2 the message is the note and nothing else. Version 1 composed
// it as "note\n\n[title](url)", so the note is whatever precedes the blank line.
func noteFromMessage(version int, message string) string {
	if version >= 2 {
		return strings.TrimSpace(message)
	}
	split := strings.Index(message, "\n\n")
	if split == -1 {
		return ""
	}
	return strings.TrimSpace(message[:split])
}
