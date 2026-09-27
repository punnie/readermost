package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// CreateShare records a share that is about to be posted, so its id can go into
// the post as a link back to the river. The post id follows via AttachSharePost.
func (s *Store) CreateShare(ctx context.Context, id string, userID int64, entryURL string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO shares (id, user_id, entry_url, created_at)
		VALUES (?, ?, ?, ?)`,
		id, userID, entryURL, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("store: create share: %w", err)
	}
	return nil
}

// AttachSharePost ties a share to the Mattermost post it became.
func (s *Store) AttachSharePost(ctx context.Context, id, postID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE shares SET post_id = ? WHERE id = ?`, postID, id)
	if err != nil {
		return fmt.Errorf("store: attach share post: %w", err)
	}
	return nil
}

// DeleteShare removes a share whose post never made it to Mattermost.
func (s *Store) DeleteShare(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM shares WHERE id = ?`, id); err != nil {
		return fmt.Errorf("store: delete share: %w", err)
	}
	return nil
}

// SharePostID resolves a share link to its post. A share that is unknown, or
// whose post was never attached, is ErrNotFound.
func (s *Store) SharePostID(ctx context.Context, id string) (string, error) {
	var postID string
	err := s.db.QueryRowContext(ctx,
		`SELECT post_id FROM shares WHERE id = ?`, id).Scan(&postID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && postID == "") {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("store: share post id: %w", err)
	}
	return postID, nil
}
