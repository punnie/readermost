// Package miniflux is a typed client for the Miniflux REST API.
//
// Miniflux has no act-on-behalf-of-user facility: every call is authenticated as
// exactly one account. Readermost therefore holds two kinds of client — an admin
// one used solely to provision accounts, and a per-user one built from the
// password the app generated for that user.
package miniflux

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

// Client talks to Miniflux as a single account.
type Client struct {
	baseURL  string
	username string
	password string
	http     *http.Client
}

// New returns a client authenticating as the given account.
func New(baseURL, username, password string) *Client {
	return &Client{
		baseURL:  strings.TrimRight(baseURL, "/"),
		username: username,
		password: password,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Error is a non-2xx response from Miniflux.
//
// It deliberately carries only the status and Miniflux's own error message. The
// request that produced it was authenticated with a user's password, so nothing
// from the request is ever attached.
type Error struct {
	StatusCode int
	Message    string
}

func (e *Error) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("miniflux: unexpected status %d", e.StatusCode)
	}
	return fmt.Sprintf("miniflux: %s (status %d)", e.Message, e.StatusCode)
}

// IsNotFound reports whether err is a 404 from Miniflux.
func IsNotFound(err error) bool { return statusIs(err, http.StatusNotFound) }

// IsConflict reports whether err is a 409 — most importantly, "this username
// already exists", which drives the re-provisioning recovery path.
func IsConflict(err error) bool { return statusIs(err, http.StatusConflict) }

// IsUnauthorized reports whether err is a 401, meaning the stored password no
// longer matches the Miniflux account.
func IsUnauthorized(err error) bool { return statusIs(err, http.StatusUnauthorized) }

func statusIs(err error, code int) bool {
	var apiErr *Error
	if !asError(err, &apiErr) {
		return false
	}
	return apiErr.StatusCode == code
}

// do issues a request and decodes a JSON response into out (which may be nil).
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("miniflux: encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("miniflux: build request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		// Do's error embeds the URL but never credentials, since they travel in
		// the Authorization header.
		return fmt.Errorf("miniflux: %s %s: %w", method, path, err)
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
		return fmt.Errorf("miniflux: decode %s %s: %w", method, path, err)
	}
	return nil
}

// doRaw issues a request and hands back the live response for streaming bodies
// (OPML export, feed icons). The caller must close resp.Body.
func (c *Client) doRaw(ctx context.Context, method, path, contentType string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, fmt.Errorf("miniflux: build request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("miniflux: %s %s: %w", method, path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, newAPIError(resp)
	}
	return resp, nil
}

// newAPIError reads Miniflux's error payload, which is {"error_message": "..."}.
func newAPIError(resp *http.Response) error {
	apiErr := &Error{StatusCode: resp.StatusCode}

	// Cap the read: an error body should be tiny, and an HTML error page from a
	// reverse proxy in front of Miniflux should not end up in our logs whole.
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if err != nil {
		return apiErr
	}

	var decoded struct {
		ErrorMessage string `json:"error_message"`
	}
	if json.Unmarshal(payload, &decoded) == nil && decoded.ErrorMessage != "" {
		apiErr.Message = decoded.ErrorMessage
	}
	return apiErr
}

// query builds a query string from non-empty values.
func query(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	return "?" + values.Encode()
}
