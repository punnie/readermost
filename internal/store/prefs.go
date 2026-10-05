package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ReadingPrefs is how a user wants articles and their discussions typeset, the
// accent colour the rest of the app is drawn in, and whether unread items are
// counted or merely marked.
//
// The values are opaque to the store; the API layer decides which are valid.
type ReadingPrefs struct {
	FontFamily string
	TextSize   string
	Density    string
	Accent     string
	UnreadMark string
}

// DefaultReadingPrefs is what a user gets before they have chosen anything.
var DefaultReadingPrefs = ReadingPrefs{
	FontFamily: "sans",
	TextSize:   "medium",
	Density:    "comfortable",
	Accent:     "blue",
	UnreadMark: "count",
}

// ReadingPrefs returns a user's reading preferences, or the defaults if they
// have never saved any.
func (s *Store) ReadingPrefs(ctx context.Context, userID int64) (ReadingPrefs, error) {
	var prefs ReadingPrefs
	err := s.db.QueryRowContext(ctx,
		`SELECT font_family, text_size, density, accent, unread_mark FROM reading_prefs WHERE user_id = ?`, userID).
		Scan(&prefs.FontFamily, &prefs.TextSize, &prefs.Density, &prefs.Accent, &prefs.UnreadMark)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultReadingPrefs, nil
	}
	if err != nil {
		return ReadingPrefs{}, fmt.Errorf("store: reading prefs: %w", err)
	}
	return prefs, nil
}

// SetReadingPrefs replaces a user's reading preferences.
func (s *Store) SetReadingPrefs(ctx context.Context, userID int64, prefs ReadingPrefs) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO reading_prefs (user_id, font_family, text_size, density, accent, unread_mark, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			font_family = excluded.font_family,
			text_size   = excluded.text_size,
			density     = excluded.density,
			accent      = excluded.accent,
			unread_mark = excluded.unread_mark,
			updated_at  = excluded.updated_at`,
		userID, prefs.FontFamily, prefs.TextSize, prefs.Density, prefs.Accent, prefs.UnreadMark, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("store: set reading prefs: %w", err)
	}
	return nil
}
