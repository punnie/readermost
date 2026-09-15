package mattermost

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// Me returns the account this client is authenticated as.
func (c *Client) Me(ctx context.Context) (*User, error) {
	var user User
	if err := c.do(ctx, http.MethodGet, "/api/v4/users/me", nil, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

// UsersByIDs resolves post authors in one round trip.
func (c *Client) UsersByIDs(ctx context.Context, ids []string) ([]*User, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var users []*User
	if err := c.do(ctx, http.MethodPost, "/api/v4/users/ids", ids, &users); err != nil {
		return nil, err
	}
	return users, nil
}

// Channel fetches channel metadata, and doubles as an access check: a user who
// cannot see the channel gets 403 here.
func (c *Client) Channel(ctx context.Context, channelID string) (*Channel, error) {
	var channel Channel
	path := "/api/v4/channels/" + url.PathEscape(channelID)
	if err := c.do(ctx, http.MethodGet, path, nil, &channel); err != nil {
		return nil, err
	}
	return &channel, nil
}

// ChannelPostOptions pages through a channel.
type ChannelPostOptions struct {
	PerPage int
	Before  string // post ID; returns posts older than it
	After   string // post ID; returns posts newer than it
	Page    int
}

// ChannelPosts lists posts in a channel, newest first.
func (c *Client) ChannelPosts(ctx context.Context, channelID string, opts ChannelPostOptions) (*PostList, error) {
	values := url.Values{}
	if opts.PerPage > 0 {
		values.Set("per_page", strconv.Itoa(opts.PerPage))
	}
	if opts.Page > 0 {
		values.Set("page", strconv.Itoa(opts.Page))
	}
	if opts.Before != "" {
		values.Set("before", opts.Before)
	}
	if opts.After != "" {
		values.Set("after", opts.After)
	}

	path := "/api/v4/channels/" + url.PathEscape(channelID) + "/posts"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}

	var list PostList
	if err := c.do(ctx, http.MethodGet, path, nil, &list); err != nil {
		return nil, err
	}
	return &list, nil
}

// PostThread returns a root post and all of its replies.
func (c *Client) PostThread(ctx context.Context, postID string) (*PostList, error) {
	var list PostList
	path := "/api/v4/posts/" + url.PathEscape(postID) + "/thread"
	if err := c.do(ctx, http.MethodGet, path, nil, &list); err != nil {
		return nil, err
	}
	return &list, nil
}

// Post fetches a single post.
func (c *Client) Post(ctx context.Context, postID string) (*Post, error) {
	var post Post
	path := "/api/v4/posts/" + url.PathEscape(postID)
	if err := c.do(ctx, http.MethodGet, path, nil, &post); err != nil {
		return nil, err
	}
	return &post, nil
}

// CreatePost publishes a message as the authenticated user. Set RootID to reply
// in a thread.
func (c *Client) CreatePost(ctx context.Context, post *Post) (*Post, error) {
	payload := map[string]any{
		"channel_id": post.ChannelID,
		"message":    post.Message,
	}
	if post.RootID != "" {
		payload["root_id"] = post.RootID
	}
	if len(post.Props) > 0 {
		payload["props"] = post.Props
	}

	var created Post
	if err := c.do(ctx, http.MethodPost, "/api/v4/posts", payload, &created); err != nil {
		return nil, err
	}
	return &created, nil
}

// SharedLink extracts Readermost's metadata from a post, if it has any. A post
// typed into Mattermost by hand simply has none.
func (p *Post) SharedLink() (*SharedLink, bool) {
	if p == nil || len(p.Props) == 0 {
		return nil, false
	}
	raw, ok := p.Props[PropsKey]
	if !ok {
		return nil, false
	}

	// Props round-trip through JSON as map[string]any; re-encoding is the
	// cheapest way to land in a typed struct.
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	var link SharedLink
	if err := json.Unmarshal(encoded, &link); err != nil {
		return nil, false
	}
	if link.EntryURL == "" {
		return nil, false
	}
	return &link, true
}

// SetSharedLink attaches Readermost metadata to an outgoing post.
func (p *Post) SetSharedLink(link *SharedLink) error {
	encoded, err := json.Marshal(link)
	if err != nil {
		return fmt.Errorf("mattermost: encode share props: %w", err)
	}
	var generic map[string]any
	if err := json.Unmarshal(encoded, &generic); err != nil {
		return fmt.Errorf("mattermost: encode share props: %w", err)
	}
	if p.Props == nil {
		p.Props = map[string]any{}
	}
	p.Props[PropsKey] = generic
	return nil
}
