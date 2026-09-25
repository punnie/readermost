package store

import (
	"context"
	"errors"
	"testing"
)

func TestShareResolvesOnceAttached(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	if err := db.CreateShare(ctx, "abc", userID, "https://example.com/a"); err != nil {
		t.Fatalf("CreateShare: %v", err)
	}

	// Between creating the row and Mattermost answering, the link leads nowhere.
	if _, err := db.SharePostID(ctx, "abc"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("SharePostID before attach = %v, want ErrNotFound", err)
	}

	if err := db.AttachSharePost(ctx, "abc", "post1"); err != nil {
		t.Fatalf("AttachSharePost: %v", err)
	}
	postID, err := db.SharePostID(ctx, "abc")
	if err != nil {
		t.Fatalf("SharePostID: %v", err)
	}
	if postID != "post1" {
		t.Errorf("SharePostID = %q, want post1", postID)
	}
}

func TestShareUnknownAndDeleted(t *testing.T) {
	db, userID := newTestStore(t)
	ctx := context.Background()

	if _, err := db.SharePostID(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("SharePostID(missing) = %v, want ErrNotFound", err)
	}

	if err := db.CreateShare(ctx, "gone", userID, "https://example.com/a"); err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if err := db.AttachSharePost(ctx, "gone", "post1"); err != nil {
		t.Fatalf("AttachSharePost: %v", err)
	}
	if err := db.DeleteShare(ctx, "gone"); err != nil {
		t.Fatalf("DeleteShare: %v", err)
	}
	if _, err := db.SharePostID(ctx, "gone"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("SharePostID after delete = %v, want ErrNotFound", err)
	}
}
