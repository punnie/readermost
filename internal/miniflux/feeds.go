package miniflux

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

// Categories lists the user's folders. With counts, each carries its unread
// total, which is what the sidebar renders.
func (c *Client) Categories(ctx context.Context, withCounts bool) ([]*Category, error) {
	path := "/v1/categories"
	if withCounts {
		path += "?counts=true"
	}
	var categories []*Category
	if err := c.do(ctx, http.MethodGet, path, nil, &categories); err != nil {
		return nil, err
	}
	return categories, nil
}

// CreateCategory adds a folder.
func (c *Client) CreateCategory(ctx context.Context, title string) (*Category, error) {
	var category Category
	payload := map[string]any{"title": title}
	if err := c.do(ctx, http.MethodPost, "/v1/categories", payload, &category); err != nil {
		return nil, err
	}
	return &category, nil
}

// UpdateCategory renames a folder.
func (c *Client) UpdateCategory(ctx context.Context, id int64, title string) (*Category, error) {
	var category Category
	payload := map[string]any{"title": title}
	path := fmt.Sprintf("/v1/categories/%d", id)
	if err := c.do(ctx, http.MethodPut, path, payload, &category); err != nil {
		return nil, err
	}
	return &category, nil
}

// DeleteCategory removes a folder. Miniflux moves its feeds to the default one.
func (c *Client) DeleteCategory(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodDelete, fmt.Sprintf("/v1/categories/%d", id), nil, nil)
}

// Feeds lists every subscription.
func (c *Client) Feeds(ctx context.Context) ([]*Feed, error) {
	var feeds []*Feed
	if err := c.do(ctx, http.MethodGet, "/v1/feeds", nil, &feeds); err != nil {
		return nil, err
	}
	return feeds, nil
}

// CreateFeed subscribes to feedURL inside a category.
func (c *Client) CreateFeed(ctx context.Context, feedURL string, categoryID int64) (int64, error) {
	payload := map[string]any{
		"feed_url":    feedURL,
		"category_id": categoryID,
	}
	var created struct {
		FeedID int64 `json:"feed_id"`
	}
	if err := c.do(ctx, http.MethodPost, "/v1/feeds", payload, &created); err != nil {
		return 0, err
	}
	return created.FeedID, nil
}

// UpdateFeed renames a feed or moves it to another category. Only non-nil fields
// are sent, so callers can change one thing without reasserting the rest.
func (c *Client) UpdateFeed(ctx context.Context, id int64, title *string, categoryID *int64) (*Feed, error) {
	payload := map[string]any{}
	if title != nil {
		payload["title"] = *title
	}
	if categoryID != nil {
		payload["category_id"] = *categoryID
	}

	var feed Feed
	path := fmt.Sprintf("/v1/feeds/%d", id)
	if err := c.do(ctx, http.MethodPut, path, payload, &feed); err != nil {
		return nil, err
	}
	return &feed, nil
}

// DeleteFeed unsubscribes.
func (c *Client) DeleteFeed(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodDelete, fmt.Sprintf("/v1/feeds/%d", id), nil, nil)
}

// RefreshFeed asks Miniflux to poll one feed now.
func (c *Client) RefreshFeed(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodPut, fmt.Sprintf("/v1/feeds/%d/refresh", id), nil, nil)
}

// RefreshAllFeeds asks Miniflux to poll everything the user subscribes to.
func (c *Client) RefreshAllFeeds(ctx context.Context) error {
	return c.do(ctx, http.MethodPut, "/v1/feeds/refresh", nil, nil)
}

// Discover finds feeds advertised by a website, so pasting a homepage works.
func (c *Client) Discover(ctx context.Context, websiteURL string) ([]*Subscription, error) {
	payload := map[string]any{"url": websiteURL}
	var subscriptions []*Subscription
	if err := c.do(ctx, http.MethodPost, "/v1/discover", payload, &subscriptions); err != nil {
		return nil, err
	}
	return subscriptions, nil
}

// FeedIcon fetches a favicon. The Data field is base64 with a mime prefix.
func (c *Client) FeedIcon(ctx context.Context, feedID int64) (*Icon, error) {
	var icon Icon
	path := fmt.Sprintf("/v1/feeds/%d/icon", feedID)
	if err := c.do(ctx, http.MethodGet, path, nil, &icon); err != nil {
		return nil, err
	}
	return &icon, nil
}

// MarkCategoryRead marks every entry in a folder as read.
func (c *Client) MarkCategoryRead(ctx context.Context, categoryID int64) error {
	path := fmt.Sprintf("/v1/categories/%d/mark-all-as-read", categoryID)
	return c.do(ctx, http.MethodPut, path, nil, nil)
}

// MarkFeedRead marks every entry in a feed as read.
func (c *Client) MarkFeedRead(ctx context.Context, feedID int64) error {
	path := fmt.Sprintf("/v1/feeds/%d/mark-all-as-read", feedID)
	return c.do(ctx, http.MethodPut, path, nil, nil)
}

// MarkAllRead marks the user's whole account as read.
func (c *Client) MarkAllRead(ctx context.Context, userID int64) error {
	path := fmt.Sprintf("/v1/users/%d/mark-all-as-read", userID)
	return c.do(ctx, http.MethodPut, path, nil, nil)
}

// ImportOPML streams an OPML document into the account. Miniflux does the
// parsing, de-duplication and category creation.
func (c *Client) ImportOPML(ctx context.Context, opml io.Reader) (*ImportResult, error) {
	resp, err := c.doRaw(ctx, http.MethodPost, "/v1/import", "application/xml", opml)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	result := &ImportResult{}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err == nil {
		var decoded struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(payload, &decoded) == nil {
			result.Message = decoded.Message
		}
	}
	return result, nil
}

// ExportOPML streams the account's subscriptions out. The caller closes the
// returned reader.
func (c *Client) ExportOPML(ctx context.Context) (io.ReadCloser, error) {
	resp, err := c.doRaw(ctx, http.MethodGet, "/v1/export", "", nil)
	if err != nil {
		return nil, err
	}
	return resp.Body, nil
}

// pathEscape escapes a single path segment.
func pathEscape(segment string) string { return url.PathEscape(segment) }

// itoa is a small helper for query values.
func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// FeedCounters returns per-feed read and unread totals. Category listings only
// carry category-level totals, so this is what gives each feed its own badge.
// Keys are feed IDs as strings.
func (c *Client) FeedCounters(ctx context.Context) (*FeedCounters, error) {
	var counters FeedCounters
	if err := c.do(ctx, http.MethodGet, "/v1/feeds/counters", nil, &counters); err != nil {
		return nil, err
	}
	return &counters, nil
}
