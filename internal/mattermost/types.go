package mattermost

// User is a Mattermost account.
type User struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
	Position  string `json:"position"`
}

// DisplayName picks the friendliest available name.
func (u *User) DisplayName() string {
	switch {
	case u.Nickname != "":
		return u.Nickname
	case u.FirstName != "" && u.LastName != "":
		return u.FirstName + " " + u.LastName
	case u.FirstName != "":
		return u.FirstName
	default:
		return u.Username
	}
}

// Post is a message. Props is an arbitrary JSON bag that Mattermost stores and
// returns untouched — Readermost keeps its share metadata there, which is what
// lets the channel remain the single source of truth for shared links.
type Post struct {
	ID         string         `json:"id"`
	CreateAt   int64          `json:"create_at"`
	UpdateAt   int64          `json:"update_at"`
	DeleteAt   int64          `json:"delete_at"`
	UserID     string         `json:"user_id"`
	ChannelID  string         `json:"channel_id"`
	RootID     string         `json:"root_id"`
	Message    string         `json:"message"`
	Type       string         `json:"type"`
	Props      map[string]any `json:"props,omitempty"`
	ReplyCount int            `json:"reply_count"`
}

// IsSystemMessage reports whether the post is a join/leave notice rather than
// something a person wrote. These are filtered out of the shared river.
func (p *Post) IsSystemMessage() bool {
	return p.Type != "" && len(p.Type) >= 7 && p.Type[:7] == "system_"
}

// PostList is Mattermost's paginated post envelope. Order lists post IDs
// newest-first; Posts maps ID to post.
type PostList struct {
	Order      []string         `json:"order"`
	Posts      map[string]*Post `json:"posts"`
	NextPostID string           `json:"next_post_id"`
	PrevPostID string           `json:"prev_post_id"`
	HasNext    bool             `json:"has_next"`
}

// Ordered returns the posts in Order, skipping any the map lacks.
func (l *PostList) Ordered() []*Post {
	if l == nil {
		return nil
	}
	posts := make([]*Post, 0, len(l.Order))
	for _, id := range l.Order {
		if post, ok := l.Posts[id]; ok {
			posts = append(posts, post)
		}
	}
	return posts
}

// Channel is a Mattermost channel.
type Channel struct {
	ID          string `json:"id"`
	TeamID      string `json:"team_id"`
	Type        string `json:"type"`
	DisplayName string `json:"display_name"`
	Name        string `json:"name"`
	Purpose     string `json:"purpose"`
	Header      string `json:"header"`
}

// PropsKey is the key under which Readermost stores share metadata on a post.
const PropsKey = "readermost"

// SharePropsVersion is the schema version of SharedLink, so a future change can
// be recognised rather than guessed at.
const SharePropsVersion = 1

// SharedLink is the metadata Readermost attaches to a shared post.
//
// It deliberately carries no Miniflux entry ID: those are scoped per user, so
// the same article has a different ID in every account. EntryURL is the key.
type SharedLink struct {
	Version   int    `json:"v"`
	EntryURL  string `json:"entry_url"`
	Title     string `json:"title"`
	FeedTitle string `json:"feed_title"`
	// FeedURL is the feed itself, not the site — it is what lets a reader
	// subscribe straight from the river. Absent on shares made before this.
	FeedURL     string `json:"feed_url,omitempty"`
	FeedSiteURL string `json:"feed_site_url"`
	Author      string `json:"author"`
	PublishedAt string `json:"published_at"`
	// Excerpt is a short plain-text preview so the river can show what an
	// article is about without refetching it. Absent on older shares.
	Excerpt string `json:"excerpt,omitempty"`
}
