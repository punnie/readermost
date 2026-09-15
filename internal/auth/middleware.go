package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/punnie/readermost/internal/crypto"
	"github.com/punnie/readermost/internal/miniflux"
	"github.com/punnie/readermost/internal/store"
)

// Middleware attaches the signed-in Identity to the request context when a valid
// session cookie is present. It never rejects: RequireAuth does that.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, err := s.identify(r)
		if err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				s.log.Warn("session lookup failed", "error", err)
			}
			// An expired or unknown session should not leave a stale cookie
			// bouncing the browser between login and 401 forever.
			if errors.Is(err, store.ErrNotFound) {
				s.clearCookie(w, sessionCookie, "/")
			}
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, identity)))
	})
}

// RequireAuth rejects unauthenticated API requests with 401.
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := FromContext(r.Context()); !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"not signed in"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// identify resolves the session cookie into an Identity with decrypted upstream
// credentials.
func (s *Service) identify(r *http.Request) (*Identity, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil, store.ErrNotFound
	}

	session, user, err := s.store.SessionByID(r.Context(), cookie.Value)
	if err != nil {
		return nil, err
	}

	mmToken, err := s.sealer.OpenString(session.MattermostTokenEnc)
	if err != nil {
		return nil, fmt.Errorf("open mattermost token: %w", err)
	}
	mfPassword, err := s.sealer.OpenString(user.MinifluxPasswordEnc)
	if err != nil {
		return nil, fmt.Errorf("open miniflux password: %w", err)
	}

	return &Identity{
		User:             user,
		Session:          session,
		MattermostToken:  mmToken,
		MinifluxPassword: mfPassword,
	}, nil
}

// RepairMinifluxCredential re-syncs a user's Miniflux password after the stored
// one stops working — for instance because someone changed it in Miniflux
// directly. It resets the password as admin and updates the identity in place,
// so the caller can simply retry.
func (s *Service) RepairMinifluxCredential(ctx context.Context, identity *Identity) error {
	password, err := crypto.RandomPassword()
	if err != nil {
		return fmt.Errorf("generate miniflux password: %w", err)
	}

	minifluxUserID := identity.User.MinifluxUserID
	if minifluxUserID == 0 {
		existing, lookupErr := s.admin.UserByUsername(ctx, identity.User.MinifluxUsername)
		if lookupErr != nil {
			return fmt.Errorf("look up miniflux account: %w", lookupErr)
		}
		minifluxUserID = existing.ID
	}

	if err := s.admin.SetUserPassword(ctx, minifluxUserID, password); err != nil {
		return fmt.Errorf("reset miniflux password: %w", err)
	}

	sealed, err := s.sealer.SealString(password)
	if err != nil {
		return fmt.Errorf("seal miniflux password: %w", err)
	}
	if err := s.store.UpdateMinifluxCredential(ctx, identity.User.ID, minifluxUserID,
		identity.User.MinifluxUsername, sealed); err != nil {
		return err
	}

	identity.User.MinifluxUserID = minifluxUserID
	identity.User.MinifluxPasswordEnc = sealed
	identity.MinifluxPassword = password

	s.log.Info("repaired miniflux credential", "miniflux_username", identity.User.MinifluxUsername)
	return nil
}

// MinifluxFor returns a Miniflux client for the identity.
//
// It does not validate the credential: that would cost a round trip on every
// request. Use WithMiniflux when you want the stale-password repair.
func (s *Service) MinifluxFor(identity *Identity) *miniflux.Client {
	return identity.Miniflux(s.cfg.Miniflux.URL)
}

// WithMiniflux runs fn with the identity's Miniflux client. If Miniflux rejects
// the stored password, it is reset via the admin account and fn is retried once.
//
// The stored password only goes stale if someone changes it in Miniflux
// directly, which is rare — so this costs nothing in the common case, and turns
// an otherwise unrecoverable account into a transparent repair.
func (s *Service) WithMiniflux(ctx context.Context, identity *Identity, fn func(*miniflux.Client) error) error {
	err := fn(s.MinifluxFor(identity))
	if !miniflux.IsUnauthorized(err) {
		return err
	}

	if repairErr := s.RepairMinifluxCredential(ctx, identity); repairErr != nil {
		// Report the repair failure: it explains the original 401.
		return repairErr
	}
	return fn(s.MinifluxFor(identity))
}

// Store exposes the underlying store to handlers that need it (onboarding).
func (s *Service) Store() *store.Store { return s.store }
