// Package store is the only state Readermost owns.
//
// Everything a user reads or says lives upstream: subscriptions and read state in
// Miniflux, shared links and comments in Mattermost. This database exists purely
// because Miniflux has no act-on-behalf-of-user API — the app must remember the
// password it generated for each Miniflux account — plus the sessions that tie a
// browser to a Mattermost identity.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver: keeps the binary CGO-free
)

// ErrNotFound is returned by lookups that match no row.
var ErrNotFound = errors.New("store: not found")

// Store wraps the SQLite database.
type Store struct {
	db *sql.DB
}

// User links a Mattermost identity to the Miniflux account provisioned for it.
type User struct {
	ID                  int64
	MattermostUserID    string
	MattermostUsername  string
	MinifluxUserID      int64
	MinifluxUsername    string
	MinifluxPasswordEnc []byte
	Disabled            bool
	CreatedAt           time.Time
	LastSeenAt          time.Time
	OnboardedAt         *time.Time // nil until the welcome step is done or skipped
}

// Session is a browser login. It holds the user's Mattermost access token so the
// server can act as them against the Mattermost API.
type Session struct {
	ID                 string
	UserID             int64
	MattermostTokenEnc []byte
	CreatedAt          time.Time
	ExpiresAt          time.Time
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  mm_user_id             TEXT    NOT NULL UNIQUE,
  mm_username            TEXT    NOT NULL,
  miniflux_user_id       INTEGER NOT NULL,
  miniflux_username      TEXT    NOT NULL,
  miniflux_password_enc  BLOB    NOT NULL,
  disabled               INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  last_seen_at           INTEGER NOT NULL,
  onboarded_at           INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id                     TEXT    PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mm_access_token_enc    BLOB    NOT NULL,
  created_at             INTEGER NOT NULL,
  expires_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
`

// Open connects to the SQLite database at path and applies the schema.
func Open(path string) (*Store, error) {
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)" +
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}

	// SQLite serialises writes anyway; a small pool keeps lock contention and
	// busy-timeout retries rare at this scale.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(time.Hour)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: apply schema: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the database.
func (s *Store) Close() error { return s.db.Close() }

const userColumns = `id, mm_user_id, mm_username, miniflux_user_id, miniflux_username,
	miniflux_password_enc, disabled, created_at, last_seen_at, onboarded_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var (
		user        User
		createdAt   int64
		lastSeenAt  int64
		onboardedAt sql.NullInt64
	)
	err := row.Scan(
		&user.ID, &user.MattermostUserID, &user.MattermostUsername,
		&user.MinifluxUserID, &user.MinifluxUsername, &user.MinifluxPasswordEnc,
		&user.Disabled, &createdAt, &lastSeenAt, &onboardedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: scan user: %w", err)
	}

	user.CreatedAt = time.Unix(createdAt, 0).UTC()
	user.LastSeenAt = time.Unix(lastSeenAt, 0).UTC()
	if onboardedAt.Valid {
		at := time.Unix(onboardedAt.Int64, 0).UTC()
		user.OnboardedAt = &at
	}
	return &user, nil
}

// UserByMattermostID looks up the user behind a Mattermost identity.
func (s *Store) UserByMattermostID(ctx context.Context, mattermostID string) (*User, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE mm_user_id = ?`, mattermostID)
	return scanUser(row)
}

// UserByID looks up a user by primary key.
func (s *Store) UserByID(ctx context.Context, id int64) (*User, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = ?`, id)
	return scanUser(row)
}

// CreateUser inserts a freshly provisioned user and fills in its ID.
func (s *Store) CreateUser(ctx context.Context, user *User) error {
	now := time.Now().UTC()
	user.CreatedAt = now
	user.LastSeenAt = now

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO users (mm_user_id, mm_username, miniflux_user_id,
		                   miniflux_username, miniflux_password_enc,
		                   created_at, last_seen_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		user.MattermostUserID, user.MattermostUsername, user.MinifluxUserID,
		user.MinifluxUsername, user.MinifluxPasswordEnc,
		now.Unix(), now.Unix())
	if err != nil {
		return fmt.Errorf("store: create user: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("store: create user id: %w", err)
	}
	user.ID = id
	return nil
}

// UpdateMinifluxCredential rewrites the stored Miniflux login. It is used by the
// re-provisioning recovery path, when the Miniflux account outlived this database
// and its password had to be reset.
func (s *Store) UpdateMinifluxCredential(ctx context.Context, userID, minifluxUserID int64, username string, passwordEnc []byte) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE users
		   SET miniflux_user_id = ?, miniflux_username = ?, miniflux_password_enc = ?
		 WHERE id = ?`,
		minifluxUserID, username, passwordEnc, userID)
	if err != nil {
		return fmt.Errorf("store: update miniflux credential: %w", err)
	}
	return nil
}

// TouchUser records that the user was just seen, and refreshes their Mattermost
// username in case they renamed themselves upstream.
func (s *Store) TouchUser(ctx context.Context, userID int64, username string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET last_seen_at = ?, mm_username = ? WHERE id = ?`,
		time.Now().UTC().Unix(), username, userID)
	if err != nil {
		return fmt.Errorf("store: touch user: %w", err)
	}
	return nil
}

// MarkOnboarded completes the welcome step, whether the user imported OPML or
// skipped it. It is idempotent and never moves the timestamp once set.
func (s *Store) MarkOnboarded(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET onboarded_at = ? WHERE id = ? AND onboarded_at IS NULL`,
		time.Now().UTC().Unix(), userID)
	if err != nil {
		return fmt.Errorf("store: mark onboarded: %w", err)
	}
	return nil
}

// CreateSession stores a new browser session.
func (s *Store) CreateSession(ctx context.Context, session *Session) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, mm_access_token_enc, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?)`,
		session.ID, session.UserID, session.MattermostTokenEnc,
		session.CreatedAt.UTC().Unix(), session.ExpiresAt.UTC().Unix())
	if err != nil {
		return fmt.Errorf("store: create session: %w", err)
	}
	return nil
}

// SessionByID returns a live session and its user. Expired sessions are reported
// as ErrNotFound, as are sessions belonging to a disabled user.
func (s *Store) SessionByID(ctx context.Context, id string) (*Session, *User, error) {
	var (
		session   Session
		createdAt int64
		expiresAt int64
	)
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, mm_access_token_enc, created_at, expires_at
		  FROM sessions WHERE id = ?`, id)

	err := row.Scan(&session.ID, &session.UserID, &session.MattermostTokenEnc, &createdAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("store: scan session: %w", err)
	}
	session.CreatedAt = time.Unix(createdAt, 0).UTC()
	session.ExpiresAt = time.Unix(expiresAt, 0).UTC()

	if time.Now().After(session.ExpiresAt) {
		return nil, nil, ErrNotFound
	}

	user, err := s.UserByID(ctx, session.UserID)
	if err != nil {
		return nil, nil, err
	}
	if user.Disabled {
		return nil, nil, ErrNotFound
	}
	return &session, user, nil
}

// DeleteSession logs a browser out.
func (s *Store) DeleteSession(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id); err != nil {
		return fmt.Errorf("store: delete session: %w", err)
	}
	return nil
}

// DeleteExpiredSessions prunes the session table and reports how many rows went.
func (s *Store) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	result, err := s.db.ExecContext(ctx,
		`DELETE FROM sessions WHERE expires_at < ?`, time.Now().UTC().Unix())
	if err != nil {
		return 0, fmt.Errorf("store: delete expired sessions: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, nil // the delete succeeded; the count is not worth an error
	}
	return affected, nil
}
