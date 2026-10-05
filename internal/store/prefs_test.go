package store

import (
	"context"
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

	want := ReadingPrefs{FontFamily: "opendyslexic", TextSize: "large", Density: "spacious"}
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
