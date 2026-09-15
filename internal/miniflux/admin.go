package miniflux

import (
	"context"
	"fmt"
	"net/http"
)

// CreateUser provisions a Miniflux account. Admin only.
//
// A 409 here means the username is taken — see the recovery path in
// internal/auth, which resets the password rather than failing the login.
func (c *Client) CreateUser(ctx context.Context, username, password string) (*User, error) {
	payload := map[string]any{
		"username": username,
		"password": password,
		"is_admin": false,
	}
	var user User
	if err := c.do(ctx, http.MethodPost, "/v1/users", payload, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

// UserByUsername looks up an account by name. Admin only.
func (c *Client) UserByUsername(ctx context.Context, username string) (*User, error) {
	var user User
	if err := c.do(ctx, http.MethodGet, "/v1/users/"+pathEscape(username), nil, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

// SetUserPassword resets an account's password. Admin only.
//
// This is what makes a lost app database recoverable: the Miniflux account still
// exists with a password nobody knows, so the admin assigns a fresh one.
func (c *Client) SetUserPassword(ctx context.Context, userID int64, password string) error {
	payload := map[string]any{"password": password}
	path := fmt.Sprintf("/v1/users/%d", userID)
	return c.do(ctx, http.MethodPut, path, payload, nil)
}

// Me returns the account this client is authenticated as. It doubles as a
// credential check at startup.
func (c *Client) Me(ctx context.Context) (*User, error) {
	var user User
	if err := c.do(ctx, http.MethodGet, "/v1/me", nil, &user); err != nil {
		return nil, err
	}
	return &user, nil
}
