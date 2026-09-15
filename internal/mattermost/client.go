// Package mattermost is a typed client for the Mattermost API v4, plus the
// OAuth 2.0 flow that Readermost uses for login.
//
// Every call on behalf of a signed-in person carries that person's own OAuth
// token, so Mattermost's permissions apply without Readermost reimplementing
// them, and posts are genuinely authored by the user rather than a bot.
package mattermost

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Config identifies the Mattermost server and this OAuth application.
type Config struct {
	BaseURL      string
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

// Client talks to Mattermost, optionally as a specific user.
type Client struct {
	cfg   Config
	token string
	http  *http.Client
}

// New returns a client with no user token, able to run the OAuth exchange.
func New(cfg Config) *Client {
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	return &Client{
		cfg:  cfg,
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

// WithToken returns a shallow copy authenticated as the holder of token.
func (c *Client) WithToken(token string) *Client {
	clone := *c
	clone.token = token
	return &clone
}

// BaseURL exposes the configured server root.
func (c *Client) BaseURL() string { return c.cfg.BaseURL }

// Error is a non-2xx response from Mattermost.
type Error struct {
	StatusCode int
	Message    string
	ID         string
}

func (e *Error) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("mattermost: unexpected status %d", e.StatusCode)
	}
	return fmt.Sprintf("mattermost: %s (status %d)", e.Message, e.StatusCode)
}

// IsUnauthorized reports whether err is a 401, which for us means the user's
// OAuth token was revoked and the session should be dropped.
func IsUnauthorized(err error) bool { return statusIs(err, http.StatusUnauthorized) }

// IsForbidden reports whether err is a 403 — the user cannot see that channel.
func IsForbidden(err error) bool { return statusIs(err, http.StatusForbidden) }

// IsNotFound reports whether err is a 404.
func IsNotFound(err error) bool { return statusIs(err, http.StatusNotFound) }

func statusIs(err error, code int) bool {
	var apiErr *Error
	if !asError(err, &apiErr) {
		return false
	}
	return apiErr.StatusCode == code
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("mattermost: encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.cfg.BaseURL+path, reader)
	if err != nil {
		return fmt.Errorf("mattermost: build request: %w", err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("mattermost: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newAPIError(resp)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("mattermost: decode %s %s: %w", method, path, err)
	}
	return nil
}

// newAPIError reads Mattermost's error payload.
func newAPIError(resp *http.Response) error {
	apiErr := &Error{StatusCode: resp.StatusCode}

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if err != nil {
		return apiErr
	}

	var decoded struct {
		ID      string `json:"id"`
		Message string `json:"message"`
	}
	if json.Unmarshal(payload, &decoded) == nil {
		apiErr.Message = decoded.Message
		apiErr.ID = decoded.ID
	}
	return apiErr
}

// doRaw issues a request and hands back the live response for streaming bodies
// such as profile images. The caller must close resp.Body.
func (c *Client) doRaw(ctx context.Context, method, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.BaseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("mattermost: build request: %w", err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mattermost: %s %s: %w", method, path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, newAPIError(resp)
	}
	return resp, nil
}

// UserImage streams a user's profile picture. Mattermost always returns
// something — it generates a coloured initial when no picture is set — so this
// never needs a placeholder of its own.
func (c *Client) UserImage(ctx context.Context, userID string) (io.ReadCloser, string, error) {
	resp, err := c.doRaw(ctx, http.MethodGet, "/api/v4/users/"+url.PathEscape(userID)+"/image")
	if err != nil {
		return nil, "", err
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}
	return resp.Body, contentType, nil
}
