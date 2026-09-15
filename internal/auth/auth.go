// Package auth handles Mattermost OAuth login, Miniflux account provisioning,
// and the session that ties a browser to both.
package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/punnie/readermost/internal/config"
	"github.com/punnie/readermost/internal/crypto"
	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
	"github.com/punnie/readermost/internal/store"
)

const (
	sessionCookie = "readermost_session"
	stateCookie   = "readermost_oauth"
	stateTTL      = 10 * time.Minute
)

// Service owns authentication and provisioning.
type Service struct {
	cfg    *config.Config
	store  *store.Store
	sealer *crypto.Sealer
	mm     *mattermost.Client
	admin  *miniflux.Client
	log    *slog.Logger
}

// New builds the auth service.
func New(cfg *config.Config, db *store.Store, sealer *crypto.Sealer, mm *mattermost.Client, admin *miniflux.Client, log *slog.Logger) *Service {
	return &Service{cfg: cfg, store: db, sealer: sealer, mm: mm, admin: admin, log: log}
}

// Identity is the signed-in user, with the upstream credentials needed to act
// on their behalf. It is attached to the request context by Middleware.
type Identity struct {
	User             *store.User
	Session          *store.Session
	MattermostToken  string
	MinifluxPassword string
}

// Miniflux returns a client authenticated as this user.
func (i *Identity) Miniflux(baseURL string) *miniflux.Client {
	return miniflux.New(baseURL, i.User.MinifluxUsername, i.MinifluxPassword)
}

// Mattermost returns a client authenticated as this user.
func (i *Identity) Mattermost(base *mattermost.Client) *mattermost.Client {
	return base.WithToken(i.MattermostToken)
}

type contextKey struct{}

// FromContext returns the signed-in identity, if any.
func FromContext(ctx context.Context) (*Identity, bool) {
	identity, ok := ctx.Value(contextKey{}).(*Identity)
	return identity, ok
}

// oauthState is sealed into a short-lived cookie across the OAuth round trip.
type oauthState struct {
	State      string `json:"state"`
	Verifier   string `json:"verifier"`
	ExpiresAt  int64  `json:"expires_at"`
	ReturnPath string `json:"return_path"`
}

// Login starts the OAuth flow.
func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	state, err := crypto.RandomID()
	if err != nil {
		s.fail(w, r, "generate state", err)
		return
	}
	pkce, err := mattermost.NewPKCE()
	if err != nil {
		s.fail(w, r, "generate pkce", err)
		return
	}

	// Only same-origin relative paths are honoured, so this cannot be turned
	// into an open redirect.
	returnPath := r.URL.Query().Get("return")
	if len(returnPath) == 0 || returnPath[0] != '/' || (len(returnPath) > 1 && returnPath[1] == '/') {
		returnPath = "/"
	}

	payload, err := json.Marshal(oauthState{
		State:      state,
		Verifier:   pkce.Verifier,
		ExpiresAt:  time.Now().Add(stateTTL).Unix(),
		ReturnPath: returnPath,
	})
	if err != nil {
		s.fail(w, r, "encode state", err)
		return
	}
	sealed, err := s.sealer.Seal(payload)
	if err != nil {
		s.fail(w, r, "seal state", err)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     stateCookie,
		Value:    base64.RawURLEncoding.EncodeToString(sealed),
		Path:     "/auth",
		MaxAge:   int(stateTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.cfg.IsHTTPS(),
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, s.mm.AuthorizeURL(state, pkce), http.StatusFound)
}

// Callback completes the OAuth flow, provisioning on first sight of a user.
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if errParam := r.URL.Query().Get("error"); errParam != "" {
		// The user declined, or Mattermost rejected the app.
		s.log.Info("oauth denied", "error", errParam)
		http.Error(w, "Authorization was declined.", http.StatusForbidden)
		return
	}

	cookie, err := r.Cookie(stateCookie)
	if err != nil {
		http.Error(w, "Login session expired. Please try again.", http.StatusBadRequest)
		return
	}
	// The state cookie is single-use whatever happens next.
	s.clearCookie(w, stateCookie, "/auth")

	sealed, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil {
		http.Error(w, "Invalid login state.", http.StatusBadRequest)
		return
	}
	payload, err := s.sealer.Open(sealed)
	if err != nil {
		http.Error(w, "Invalid login state.", http.StatusBadRequest)
		return
	}

	var saved oauthState
	if err := json.Unmarshal(payload, &saved); err != nil {
		http.Error(w, "Invalid login state.", http.StatusBadRequest)
		return
	}
	if time.Now().Unix() > saved.ExpiresAt {
		http.Error(w, "Login took too long. Please try again.", http.StatusBadRequest)
		return
	}
	if got := r.URL.Query().Get("state"); got == "" || got != saved.State {
		http.Error(w, "Invalid login state.", http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "No authorization code returned.", http.StatusBadRequest)
		return
	}

	token, err := s.mm.ExchangeCode(ctx, code, &mattermost.PKCE{Verifier: saved.Verifier})
	if err != nil {
		s.fail(w, r, "exchange code", err)
		return
	}

	mmUser, err := s.mm.WithToken(token.AccessToken).Me(ctx)
	if err != nil {
		s.fail(w, r, "fetch mattermost user", err)
		return
	}

	user, err := s.ensureUser(ctx, mmUser)
	if err != nil {
		s.fail(w, r, "provision user", err)
		return
	}
	if user.Disabled {
		http.Error(w, "This account has been disabled.", http.StatusForbidden)
		return
	}

	if err := s.startSession(ctx, w, user, token.AccessToken); err != nil {
		s.fail(w, r, "start session", err)
		return
	}

	http.Redirect(w, r, saved.ReturnPath, http.StatusFound)
}

// ensureUser returns the stored user for a Mattermost identity, provisioning a
// Miniflux account the first time we see them.
func (s *Service) ensureUser(ctx context.Context, mmUser *mattermost.User) (*store.User, error) {
	user, err := s.store.UserByMattermostID(ctx, mmUser.ID)
	switch {
	case err == nil:
		if touchErr := s.store.TouchUser(ctx, user.ID, mmUser.Username); touchErr != nil {
			s.log.Warn("touch user failed", "error", touchErr)
		}
		user.MattermostUsername = mmUser.Username
		return user, nil

	case errors.Is(err, store.ErrNotFound):
		return s.provision(ctx, mmUser)

	default:
		return nil, err
	}
}

// provision creates the Miniflux account backing a new user.
func (s *Service) provision(ctx context.Context, mmUser *mattermost.User) (*store.User, error) {
	// Keyed on the immutable Mattermost ID, not the username, so a rename
	// upstream never orphans the Miniflux account.
	username := "mm_" + mmUser.ID

	password, err := crypto.RandomPassword()
	if err != nil {
		return nil, fmt.Errorf("generate miniflux password: %w", err)
	}

	mfUser, err := s.admin.CreateUser(ctx, username, password)
	if miniflux.IsConflict(err) {
		// The Miniflux account outlived this database — most likely the SQLite
		// file was wiped. The old password is unrecoverable, so reset it and
		// adopt the account, keeping the user's feeds and read history.
		s.log.Info("adopting existing miniflux account", "username", username)

		existing, lookupErr := s.admin.UserByUsername(ctx, username)
		if lookupErr != nil {
			return nil, fmt.Errorf("adopt miniflux account: %w", lookupErr)
		}
		if resetErr := s.admin.SetUserPassword(ctx, existing.ID, password); resetErr != nil {
			return nil, fmt.Errorf("reset miniflux password: %w", resetErr)
		}
		mfUser = existing
	} else if err != nil {
		return nil, fmt.Errorf("create miniflux user: %w", err)
	}

	sealedPassword, err := s.sealer.SealString(password)
	if err != nil {
		return nil, fmt.Errorf("seal miniflux password: %w", err)
	}

	user := &store.User{
		MattermostUserID:    mmUser.ID,
		MattermostUsername:  mmUser.Username,
		MinifluxUserID:      mfUser.ID,
		MinifluxUsername:    username,
		MinifluxPasswordEnc: sealedPassword,
	}
	if err := s.store.CreateUser(ctx, user); err != nil {
		return nil, err
	}

	s.log.Info("provisioned user",
		"mattermost_username", mmUser.Username,
		"miniflux_user_id", mfUser.ID)
	return user, nil
}

// startSession issues the session cookie.
func (s *Service) startSession(ctx context.Context, w http.ResponseWriter, user *store.User, mmToken string) error {
	id, err := crypto.RandomID()
	if err != nil {
		return fmt.Errorf("generate session id: %w", err)
	}
	sealedToken, err := s.sealer.SealString(mmToken)
	if err != nil {
		return fmt.Errorf("seal mattermost token: %w", err)
	}

	now := time.Now().UTC()
	session := &store.Session{
		ID:                 id,
		UserID:             user.ID,
		MattermostTokenEnc: sealedToken,
		CreatedAt:          now,
		ExpiresAt:          now.Add(s.cfg.SessionTTL.Std()),
	}
	if err := s.store.CreateSession(ctx, session); err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    id,
		Path:     "/",
		MaxAge:   int(s.cfg.SessionTTL.Std().Seconds()),
		HttpOnly: true,
		Secure:   s.cfg.IsHTTPS(),
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// Logout ends the session and releases the Mattermost grant.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if identity, ok := FromContext(ctx); ok {
		// Best effort: a revoked token is tidy, but a failure here must not stop
		// the user from logging out locally.
		if err := s.mm.RevokeToken(ctx, identity.MattermostToken); err != nil {
			s.log.Warn("revoke mattermost token failed", "error", err)
		}
		if err := s.store.DeleteSession(ctx, identity.Session.ID); err != nil {
			s.log.Warn("delete session failed", "error", err)
		}
	}

	s.clearCookie(w, sessionCookie, "/")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) clearCookie(w http.ResponseWriter, name, path string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     path,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cfg.IsHTTPS(),
		SameSite: http.SameSiteLaxMode,
	})
}

// fail logs the real error and returns a generic one, so upstream failures never
// leak details (or credentials) to the browser.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, what string, err error) {
	s.log.Error("auth: "+what+" failed", "error", err, "path", r.URL.Path)
	http.Error(w, "Sign-in failed. Please try again.", http.StatusBadGateway)
}
