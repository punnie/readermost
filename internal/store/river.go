package store

import (
	"context"
	"fmt"
	"time"
)

// RiverRead is a user's read state for one shared item.
//
// Timestamps are Mattermost's clock — unix milliseconds — because they are
// compared against post create_at values, not against anything of ours.
type RiverRead struct {
	PostID      string
	ReadAt      int64
	SeenReplyAt int64
}

// RiverReads returns every read record for a user, keyed by post ID.
//
// The whole set is loaded at once because the river list needs to annotate
// every item it renders, and a friend-group's river is small.
func (s *Store) RiverReads(ctx context.Context, userID int64) (map[string]RiverRead, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT post_id, read_at, seen_reply_at FROM river_reads WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("store: river reads: %w", err)
	}
	defer rows.Close()

	reads := make(map[string]RiverRead)
	for rows.Next() {
		var read RiverRead
		if err := rows.Scan(&read.PostID, &read.ReadAt, &read.SeenReplyAt); err != nil {
			return nil, fmt.Errorf("store: scan river read: %w", err)
		}
		reads[read.PostID] = read
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: river reads: %w", err)
	}
	return reads, nil
}

// MarkRiverRead records that a user has seen an item and its replies up to
// seenReplyAt.
//
// Re-reading an item that already has newer replies must move seen_reply_at
// forward, so the badge clears — hence the upsert rather than an insert-if-absent.
func (s *Store) MarkRiverRead(ctx context.Context, userID int64, postID string, seenReplyAt int64) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO river_reads (user_id, post_id, read_at, seen_reply_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, post_id) DO UPDATE SET
			read_at = excluded.read_at,
			seen_reply_at = MAX(river_reads.seen_reply_at, excluded.seen_reply_at)`,
		userID, postID, time.Now().UTC().UnixMilli(), seenReplyAt)
	if err != nil {
		return fmt.Errorf("store: mark river read: %w", err)
	}
	return nil
}

// MarkRiverReadBatch marks many items read in one transaction, for "mark all
// read" across a river that may hold hundreds of items.
func (s *Store) MarkRiverReadBatch(ctx context.Context, userID int64, seen map[string]int64) error {
	if len(seen) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin mark river read batch: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO river_reads (user_id, post_id, read_at, seen_reply_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, post_id) DO UPDATE SET
			read_at = excluded.read_at,
			seen_reply_at = MAX(river_reads.seen_reply_at, excluded.seen_reply_at)`)
	if err != nil {
		return fmt.Errorf("store: prepare mark river read batch: %w", err)
	}
	defer stmt.Close()

	now := time.Now().UTC().UnixMilli()
	for postID, seenReplyAt := range seen {
		if _, err := stmt.ExecContext(ctx, userID, postID, now, seenReplyAt); err != nil {
			return fmt.Errorf("store: mark river read batch: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit mark river read batch: %w", err)
	}
	return nil
}

// MarkRiverUnread removes a read record, putting the item back in bold.
func (s *Store) MarkRiverUnread(ctx context.Context, userID int64, postID string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM river_reads WHERE user_id = ? AND post_id = ?`, userID, postID)
	if err != nil {
		return fmt.Errorf("store: mark river unread: %w", err)
	}
	return nil
}
