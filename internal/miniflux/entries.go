package miniflux

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// EntryFilter selects entries. Zero values mean "unset" and are omitted.
type EntryFilter struct {
	Status     []string
	FeedID     int64
	CategoryID int64
	Starred    *bool
	Search     string
	Limit      int
	Offset     int
	Order      string // id, status, published_at, category_title, category_id
	Direction  string // asc, desc
	AfterEntry int64
}

func (f EntryFilter) values() url.Values {
	values := url.Values{}
	for _, status := range f.Status {
		values.Add("status", status)
	}
	if f.FeedID > 0 {
		values.Set("feed_id", itoa(f.FeedID))
	}
	if f.CategoryID > 0 {
		values.Set("category_id", itoa(f.CategoryID))
	}
	if f.Starred != nil {
		values.Set("starred", fmt.Sprintf("%t", *f.Starred))
	}
	if f.Search != "" {
		values.Set("search", f.Search)
	}
	if f.Limit > 0 {
		values.Set("limit", itoa(int64(f.Limit)))
	}
	if f.Offset > 0 {
		values.Set("offset", itoa(int64(f.Offset)))
	}
	if f.Order != "" {
		values.Set("order", f.Order)
	}
	if f.Direction != "" {
		values.Set("direction", f.Direction)
	}
	if f.AfterEntry > 0 {
		values.Set("after_entry_id", itoa(f.AfterEntry))
	}
	return values
}

// Entries lists articles matching the filter.
func (c *Client) Entries(ctx context.Context, filter EntryFilter) (*EntryResultSet, error) {
	var result EntryResultSet
	path := "/v1/entries" + query(filter.values())
	if err := c.do(ctx, http.MethodGet, path, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Entry fetches one article.
func (c *Client) Entry(ctx context.Context, id int64) (*Entry, error) {
	var entry Entry
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/v1/entries/%d", id), nil, &entry); err != nil {
		return nil, err
	}
	return &entry, nil
}

// UpdateEntryStatus marks a batch of entries read or unread. Batching matters:
// the reader coalesces scroll-to-read into one call.
func (c *Client) UpdateEntryStatus(ctx context.Context, entryIDs []int64, status string) error {
	payload := map[string]any{
		"entry_ids": entryIDs,
		"status":    status,
	}
	return c.do(ctx, http.MethodPut, "/v1/entries", payload, nil)
}

// ToggleBookmark flips an entry's starred flag.
func (c *Client) ToggleBookmark(ctx context.Context, entryID int64) error {
	path := fmt.Sprintf("/v1/entries/%d/bookmark", entryID)
	return c.do(ctx, http.MethodPut, path, nil, nil)
}

// FetchOriginalContent asks Miniflux to scrape the full article, for feeds that
// only publish excerpts.
func (c *Client) FetchOriginalContent(ctx context.Context, entryID int64) (string, error) {
	var result struct {
		Content string `json:"content"`
	}
	path := fmt.Sprintf("/v1/entries/%d/fetch-content", entryID)
	if err := c.do(ctx, http.MethodGet, path, nil, &result); err != nil {
		return "", err
	}
	return result.Content, nil
}

// EnclosureReader streams an enclosure or any other raw endpoint path.
func (c *Client) RawGet(ctx context.Context, path string) (io.ReadCloser, string, error) {
	resp, err := c.doRaw(ctx, http.MethodGet, path, "", nil)
	if err != nil {
		return nil, "", err
	}
	return resp.Body, resp.Header.Get("Content-Type"), nil
}
