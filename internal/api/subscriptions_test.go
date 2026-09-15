package api

import (
	"testing"

	"github.com/punnie/readermost/internal/miniflux"
)

func TestDefaultMoveTarget(t *testing.T) {
	categories := []*miniflux.Category{
		{ID: 7, Title: "SW Engineer Blogs"},
		{ID: 2, Title: "All"},
		{ID: 5, Title: "Comics"},
	}

	// The oldest remaining folder, whatever order the API returned them in.
	if got := defaultMoveTarget(categories, 5); got != 2 {
		t.Errorf("defaultMoveTarget = %d, want 2 (the oldest folder)", got)
	}

	// Excluding the oldest promotes the next one.
	if got := defaultMoveTarget(categories, 2); got != 5 {
		t.Errorf("defaultMoveTarget excluding the oldest = %d, want 5", got)
	}

	// Nowhere to go: deleting would destroy the feeds, so the caller must stop.
	if got := defaultMoveTarget([]*miniflux.Category{{ID: 3}}, 3); got != 0 {
		t.Errorf("defaultMoveTarget with no other folder = %d, want 0", got)
	}
	if got := defaultMoveTarget(nil, 1); got != 0 {
		t.Errorf("defaultMoveTarget of nothing = %d, want 0", got)
	}
}

func TestFeedsInCategory(t *testing.T) {
	feeds := []*miniflux.Feed{
		{ID: 1, Category: &miniflux.Category{ID: 5}},
		{ID: 2, Category: &miniflux.Category{ID: 7}},
		{ID: 3, Category: &miniflux.Category{ID: 5}},
		// Miniflux should always set a category, but a nil one must not panic.
		{ID: 4, Category: nil},
	}

	got := feedsInCategory(feeds, 5)
	if len(got) != 2 {
		t.Fatalf("feedsInCategory found %d feeds, want 2", len(got))
	}
	if got[0].ID != 1 || got[1].ID != 3 {
		t.Errorf("feedsInCategory returned %d and %d, want 1 and 3", got[0].ID, got[1].ID)
	}

	if found := feedsInCategory(feeds, 99); len(found) != 0 {
		t.Errorf("feedsInCategory of an empty folder found %d feeds", len(found))
	}
}
