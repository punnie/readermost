package miniflux

import "time"

// Entry status values.
const (
	StatusUnread  = "unread"
	StatusRead    = "read"
	StatusRemoved = "removed"
)

// User is a Miniflux account.
type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
}

// Category is a Miniflux folder. Categories are strictly flat — there is no
// parent field, which is why the sidebar tree is exactly one level deep.
type Category struct {
	ID          int64  `json:"id"`
	UserID      int64  `json:"user_id"`
	Title       string `json:"title"`
	FeedCount   int    `json:"feed_count,omitempty"`
	TotalUnread int    `json:"total_unread,omitempty"`
}

// FeedIcon references a feed's favicon.
//
// Miniflux always sends this object, even for a feed that has no icon — in that
// case IconID is 0. Testing the pointer for nil is therefore not enough, and
// doing so makes every feed claim an icon it cannot serve.
type FeedIcon struct {
	FeedID int64 `json:"feed_id"`
	IconID int64 `json:"icon_id"`
}

// Feed is a subscription.
type Feed struct {
	ID                int64     `json:"id"`
	UserID            int64     `json:"user_id"`
	Title             string    `json:"title"`
	SiteURL           string    `json:"site_url"`
	FeedURL           string    `json:"feed_url"`
	CheckedAt         time.Time `json:"checked_at"`
	Category          *Category `json:"category,omitempty"`
	Icon              *FeedIcon `json:"icon,omitempty"`
	Disabled          bool      `json:"disabled"`
	ParsingErrorCount int       `json:"parsing_error_count"`
	ParsingErrorMsg   string    `json:"parsing_error_message"`
}

// Enclosure is a podcast or media attachment on an entry.
type Enclosure struct {
	ID       int64  `json:"id"`
	URL      string `json:"url"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size"`
}

// Entry is a single article.
//
// Note that ID is scoped to the owning user: the same article carries a
// different ID in every account, so anything shared between users must be keyed
// on URL instead.
type Entry struct {
	ID          int64       `json:"id"`
	UserID      int64       `json:"user_id"`
	FeedID      int64       `json:"feed_id"`
	Status      string      `json:"status"`
	Title       string      `json:"title"`
	URL         string      `json:"url"`
	CommentsURL string      `json:"comments_url"`
	Author      string      `json:"author"`
	Content     string      `json:"content"`
	Hash        string      `json:"hash"`
	PublishedAt time.Time   `json:"published_at"`
	CreatedAt   time.Time   `json:"created_at"`
	ChangedAt   time.Time   `json:"changed_at"`
	Starred     bool        `json:"starred"`
	ReadingTime int         `json:"reading_time"`
	Enclosures  []Enclosure `json:"enclosures"`
	Feed        *Feed       `json:"feed,omitempty"`
}

// EntryResultSet is the envelope returned by entry listings.
type EntryResultSet struct {
	Total   int      `json:"total"`
	Entries []*Entry `json:"entries"`
}

// Icon is a feed favicon. Data arrives base64-encoded with a mime prefix, in the
// form "image/png;base64,iVBOR...".
type Icon struct {
	ID       int64  `json:"id"`
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

// Subscription is a feed discovered from a website URL.
type Subscription struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Type  string `json:"type"`
}

// ImportResult is Miniflux's summary of an OPML import.
type ImportResult struct {
	Message string `json:"message"`
}

// FeedCounters holds per-feed entry counts, keyed by feed ID as a string.
type FeedCounters struct {
	Reads   map[string]int `json:"reads"`
	Unreads map[string]int `json:"unreads"`
}

// Unread returns the unread count for a feed.
func (c *FeedCounters) Unread(feedID int64) int {
	if c == nil || c.Unreads == nil {
		return 0
	}
	return c.Unreads[itoa(feedID)]
}

// HasIcon reports whether a feed actually has a favicon to serve.
//
// Miniflux sends the Icon object for every feed, including ones it has never
// fetched, with IconID left at 0 — so a nil check alone makes every feed claim
// an icon and every request for one 404.
func (f *Feed) HasIcon() bool {
	return f != nil && f.Icon != nil && f.Icon.IconID > 0
}
