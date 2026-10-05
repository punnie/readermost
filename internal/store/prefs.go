package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ReadingPrefs is how a user wants articles and their discussions typeset.
//
// The values are opaque to the store; the API layer decides which are valid.
type ReadingPrefs struct {
	FontFamily string
	TextSize   string
	Density    string
}

// DefaultReadingPrefs is what a user gets before they have chosen anything.
var DefaultReadingPrefs = ReadingPrefs{
	FontFamily: "sans",
	TextSize:   "medium",
	Density:    "comfortable",
}

// ReadingPrefs returns a user's reading preferences, or the defaults if they
// have never saved any.
func (s *Store) ReadingPrefs(ctx context.Context, userID int64) (ReadingPrefs, error) {
	var prefs ReadingPrefs
	err := s.db.QueryRowContext(ctx,
		`SELECT font_family, text_size, density FROM reading_prefs WHERE user_id = ?`, userID).
		Scan(&prefs.FontFamily, &prefs.TextSize, &prefs.Density)
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
		INSERT INTO reading_prefs (user_id, font_family, text_size, density, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			font_family = excluded.font_family,
			text_size   = excluded.text_size,
			density     = excluded.density,
			updated_at  = excluded.updated_at`,
		userID, prefs.FontFamily, prefs.TextSize, prefs.Density, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("store: set reading prefs: %w", err)
	}
	return nil
}
