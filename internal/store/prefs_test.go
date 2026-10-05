package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestReadingPrefsDefaultUntilSaved(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	prefs, err := db.ReadingPrefs(ctx, userID)
	if err != nil {
		t.Fatalf("ReadingPrefs: %v", err)
	}
	if prefs != DefaultReadingPrefs {
		t.Fatalf("a fresh user has %+v, want the defaults", prefs)
	}

	want := ReadingPrefs{FontFamily: "opendyslexic", TextSize: "large", Density: "spacious", Accent: "teal", UnreadMark: "dot"}
	if err := db.SetReadingPrefs(ctx, userID, want); err != nil {
		t.Fatalf("SetReadingPrefs: %v", err)
	}
	if prefs, _ = db.ReadingPrefs(ctx, userID); prefs != want {
		t.Fatalf("after saving got %+v, want %+v", prefs, want)
	}

	// Saving again replaces rather than conflicting.
	want.TextSize = "small"
	if err := db.SetReadingPrefs(ctx, userID, want); err != nil {
		t.Fatalf("SetReadingPrefs again: %v", err)
	}
	if prefs, _ = db.ReadingPrefs(ctx, userID); prefs != want {
		t.Fatalf("after re-saving got %+v, want %+v", prefs, want)
	}
}

// A database from before the accent and unread-mark columns existed gains them
// on open, and the choices already saved in it come through with the new
// defaults.
func TestOpenAddsNewColumnsToOldDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_, err = old.Exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY);
		INSERT INTO users (id) VALUES (1);
		CREATE TABLE reading_prefs (
		  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		  font_family TEXT    NOT NULL,
		  text_size   TEXT    NOT NULL,
		  density     TEXT    NOT NULL,
		  updated_at  INTEGER NOT NULL
		);
		INSERT INTO reading_prefs VALUES (1, 'serif', 'large', 'compact', 0);`)
	old.Close()
	if err != nil {
		t.Fatalf("seed the old schema: %v", err)
	}

	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	prefs, err := db.ReadingPrefs(context.Background(), 1)
	if err != nil {
		t.Fatalf("ReadingPrefs: %v", err)
	}
	want := ReadingPrefs{FontFamily: "serif", TextSize: "large", Density: "compact", Accent: "blue", UnreadMark: "count"}
	if prefs != want {
		t.Fatalf("got %+v, want %+v", prefs, want)
	}
}
