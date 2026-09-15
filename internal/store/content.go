package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// MaxContentBytes caps a cached article. Feed entries are rarely more than a
// few hundred kilobytes; anything past this is skipped rather than stored, so
// one pathological article cannot bloat the database.
const MaxContentBytes = 512 << 10

// SharedContent is the cached text of a shared article.
//
// It exists because a shared link carries only a URL, and Miniflux entry IDs
// are per-user: without this, an article is unreadable to anyone who does not
// subscribe to the feed it came from.
type SharedContent struct {
	URL         string
	Title       string
	Author      string
	FeedTitle   string
	FeedURL     string
	SiteURL     string
	Content     string
	PublishedAt int64 // unix seconds; zero when unknown
	ReadingTime int
	StoredAt    int64
}

// PutSharedContent stores or refreshes an article.
//
// Oversized content is silently skipped rather than treated as an error: the
// caller is on a path where caching is opportunistic, and failing the request
// over it would be wrong.
func (s *Store) PutSharedContent(ctx context.Context, content *SharedContent) error {
	if content.URL == "" || content.Content == "" {
		return nil
	}
	if len(content.Content) > MaxContentBytes {
		return nil
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO shared_content
			(url, title, author, feed_title, feed_url, site_url, content,
			 published_at, reading_time, stored_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(url) DO UPDATE SET
			title        = excluded.title,
			author       = excluded.author,
			feed_title   = excluded.feed_title,
			-- Keep a feed URL we already know if the new row lacks one: it is
			-- what the Subscribe button depends on.
			feed_url     = CASE WHEN excluded.feed_url = '' THEN shared_content.feed_url
			                    ELSE excluded.feed_url END,
			site_url     = excluded.site_url,
			content      = excluded.content,
			published_at = excluded.published_at,
			reading_time = excluded.reading_time,
			stored_at    = excluded.stored_at`,
		content.URL, content.Title, content.Author, content.FeedTitle,
		content.FeedURL, content.SiteURL, content.Content,
		content.PublishedAt, content.ReadingTime, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("store: put shared content: %w", err)
	}
	return nil
}

// SharedContentByURL returns cached article text, or ErrNotFound.
func (s *Store) SharedContentByURL(ctx context.Context, url string) (*SharedContent, error) {
	var (
		content     SharedContent
		publishedAt sql.NullInt64
	)

	row := s.db.QueryRowContext(ctx, `
		SELECT url, title, author, feed_title, feed_url, site_url, content,
		       published_at, reading_time, stored_at
		  FROM shared_content WHERE url = ?`, url)

	err := row.Scan(&content.URL, &content.Title, &content.Author,
		&content.FeedTitle, &content.FeedURL, &content.SiteURL, &content.Content,
		&publishedAt, &content.ReadingTime, &content.StoredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: scan shared content: %w", err)
	}
	if publishedAt.Valid {
		content.PublishedAt = publishedAt.Int64
	}
	return &content, nil
}

// FeedURLForArticle returns the feed a cached article came from, if known. It
// backs the Subscribe button for shares whose post props predate feed_url.
func (s *Store) FeedURLForArticle(ctx context.Context, url string) (string, error) {
	var feedURL string
	row := s.db.QueryRowContext(ctx,
		`SELECT feed_url FROM shared_content WHERE url = ? AND feed_url != ''`, url)

	err := row.Scan(&feedURL)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("store: feed url for article: %w", err)
	}
	return feedURL, nil
}
