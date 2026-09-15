package mattermost

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// PKCE holds a generated verifier and its challenge.
//
// Readermost is a confidential client and PKCE is therefore optional, but it
// costs nothing and closes the authorization-code interception window.
type PKCE struct {
	Verifier  string
	Challenge string
}

// NewPKCE generates a fresh verifier/challenge pair using S256.
func NewPKCE() (*PKCE, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return nil, fmt.Errorf("mattermost: generate pkce verifier: %w", err)
	}
	verifier := base64.RawURLEncoding.EncodeToString(raw)

	sum := sha256.Sum256([]byte(verifier))
	return &PKCE{
		Verifier:  verifier,
		Challenge: base64.RawURLEncoding.EncodeToString(sum[:]),
	}, nil
}

// AuthorizeURL is where the browser is sent to approve the login.
func (c *Client) AuthorizeURL(state string, pkce *PKCE) string {
	values := url.Values{}
	values.Set("response_type", "code")
	values.Set("client_id", c.cfg.ClientID)
	values.Set("redirect_uri", c.cfg.RedirectURI)
	values.Set("state", state)
	if pkce != nil {
		values.Set("code_challenge", pkce.Challenge)
		values.Set("code_challenge_method", "S256")
	}
	return c.cfg.BaseURL + "/oauth/authorize?" + values.Encode()
}

// TokenResponse is the payload from the token endpoint.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

// ExchangeCode trades an authorization code for an access token.
func (c *Client) ExchangeCode(ctx context.Context, code string, pkce *PKCE) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", c.cfg.ClientID)
	form.Set("client_secret", c.cfg.ClientSecret)
	form.Set("redirect_uri", c.cfg.RedirectURI)
	form.Set("code", code)
	if pkce != nil {
		form.Set("code_verifier", pkce.Verifier)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.cfg.BaseURL+"/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("mattermost: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// Never wrap the request itself: the form carries the client secret.
		return nil, fmt.Errorf("mattermost: token exchange failed: %w", redactURLError(err))
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, newAPIError(resp)
	}

	var token TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("mattermost: decode token response: %w", err)
	}
	if token.AccessToken == "" {
		return nil, fmt.Errorf("mattermost: token response contained no access token")
	}
	return &token, nil
}

// RevokeToken invalidates an access token, used on logout so signing out of
// Readermost genuinely releases the Mattermost grant.
func (c *Client) RevokeToken(ctx context.Context, token string) error {
	payload := map[string]any{"token": token}
	return c.do(ctx, http.MethodPost, "/api/v4/oauth/access_token/revoke", payload, nil)
}

// redactURLError strips the query from a *url.Error so a token endpoint failure
// cannot spill credentials into a log line.
func redactURLError(err error) error {
	var urlErr *url.Error
	if !asURLError(err, &urlErr) {
		return err
	}
	if parsed, parseErr := url.Parse(urlErr.URL); parseErr == nil {
		parsed.RawQuery = ""
		urlErr.URL = parsed.String()
	}
	return urlErr
}
