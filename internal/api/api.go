// Package api exposes Readermost's HTTP surface: a thin, authenticated proxy
// over Miniflux (feeds, entries, read state) and Mattermost (shared links and
// their comment threads).
//
// Handlers never forward an upstream error body verbatim. Miniflux requests are
// authenticated with a password the user never sees, and echoing upstream
// responses is how such things leak.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/config"
	"github.com/punnie/readermost/internal/hub"
	"github.com/punnie/readermost/internal/mattermost"
	"github.com/punnie/readermost/internal/miniflux"
)

// csrfHeader must be present on every mutating request. A cross-site form post
// cannot set a custom header, and SameSite=Lax already blocks the cookie on
// cross-site navigations, so together they close CSRF without tokens.
const csrfHeader = "X-Readermost"

// Server holds the dependencies shared by all handlers.
type Server struct {
	cfg  *config.Config
	auth *auth.Service
	mm   *mattermost.Client
	hub  *hub.Hub

	// channel is the cached view of the shared channel that every river
	// feature reads from.
	channel channelSnapshot
	log     *slog.Logger
}

// New builds the API server.
func New(cfg *config.Config, authService *auth.Service, mm *mattermost.Client, events *hub.Hub, log *slog.Logger) *Server {
	return &Server{cfg: cfg, auth: authService, mm: mm, hub: events, log: log}
}

// Routes returns the API mux. It is mounted by the caller alongside the
// static frontend.
func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()

	// Session
	mux.Handle("GET /api/me", s.protected(s.handleMe))

	// Reader
	mux.Handle("GET /api/tree", s.protected(s.handleTree))
	mux.Handle("GET /api/entries", s.protected(s.handleEntries))
	mux.Handle("GET /api/entries/{id}", s.protected(s.handleEntry))
	mux.Handle("PUT /api/entries/status", s.mutating(s.handleUpdateEntryStatus))
	mux.Handle("PUT /api/entries/{id}/bookmark", s.mutating(s.handleToggleBookmark))
	mux.Handle("GET /api/entries/{id}/original", s.protected(s.handleFetchOriginal))
	mux.Handle("GET /api/feeds/{id}/icon", s.protected(s.handleFeedIcon))

	// Subscriptions
	mux.Handle("POST /api/feeds", s.mutating(s.handleCreateFeed))
	mux.Handle("PUT /api/feeds/{id}", s.mutating(s.handleUpdateFeed))
	mux.Handle("DELETE /api/feeds/{id}", s.mutating(s.handleDeleteFeed))
	mux.Handle("POST /api/feeds/refresh", s.mutating(s.handleRefreshAll))
	mux.Handle("POST /api/feeds/{id}/refresh", s.mutating(s.handleRefreshFeed))
	mux.Handle("POST /api/discover", s.mutating(s.handleDiscover))
	mux.Handle("POST /api/categories", s.mutating(s.handleCreateCategory))
	mux.Handle("PUT /api/categories/{id}", s.mutating(s.handleUpdateCategory))
	mux.Handle("DELETE /api/categories/{id}", s.mutating(s.handleDeleteCategory))
	mux.Handle("POST /api/categories/{id}/refresh", s.mutating(s.handleRefreshCategory))
	mux.Handle("POST /api/mark-read", s.mutating(s.handleMarkRead))

	// Onboarding
	mux.Handle("POST /api/import", s.mutating(s.handleImportOPML))
	mux.Handle("GET /api/export", s.protected(s.handleExportOPML))
	mux.Handle("POST /api/onboarded", s.mutating(s.handleMarkOnboarded))

	// Real-time
	mux.Handle("GET /api/ws", s.protected(s.handleWS))

	// Sharing
	mux.Handle("GET /api/shared", s.protected(s.handleSharedRiver))
	mux.Handle("POST /api/share", s.mutating(s.handleShare))
	mux.Handle("GET /api/users/{id}/avatar", s.protected(s.handleAvatar))
	mux.Handle("GET /api/search/shared", s.protected(s.handleSearchShared))
	mux.Handle("GET /api/shared/lookup", s.protected(s.handleLookupShare))
	mux.Handle("GET /api/shared/{id}/article", s.protected(s.handleArticle))
	mux.Handle("POST /api/shared/{id}/read", s.mutating(s.handleMarkRiverRead))
	mux.Handle("POST /api/shared/read-all", s.mutating(s.handleMarkRiverReadAll))
	mux.Handle("GET /api/shared/{id}/thread", s.protected(s.handleThread))
	mux.Handle("POST /api/shared/{id}/comment", s.mutating(s.handleComment))

	return mux
}

// handlerFunc is a handler that has an authenticated identity and may fail.
type handlerFunc func(http.ResponseWriter, *http.Request, *auth.Identity) error

// protected requires a session and converts returned errors into responses.
func (s *Server) protected(h handlerFunc) http.Handler {
	return s.auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, _ := auth.FromContext(r.Context())
		if err := h(w, r, identity); err != nil {
			s.writeError(w, r, err)
		}
	}))
}

// mutating is protected plus the CSRF header requirement.
func (s *Server) mutating(h handlerFunc) http.Handler {
	return s.auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(csrfHeader) == "" {
			s.writeJSON(w, http.StatusForbidden, errorBody{Error: "missing " + csrfHeader + " header"})
			return
		}
		identity, _ := auth.FromContext(r.Context())
		if err := h(w, r, identity); err != nil {
			s.writeError(w, r, err)
		}
	}))
}

type errorBody struct {
	Error string `json:"error"`
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		// The status line is already out; all that is left is a log entry.
		s.log.Warn("write json response failed", "error", err)
	}
}

// badRequest is a client error whose message is safe to show the user.
type badRequest struct{ message string }

func (e *badRequest) Error() string { return e.message }

func errBadRequest(message string) error { return &badRequest{message: message} }

// writeError maps an error to a status code without leaking upstream detail.
func (s *Server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	var clientErr *badRequest
	if errors.As(err, &clientErr) {
		s.writeJSON(w, http.StatusBadRequest, errorBody{Error: clientErr.message})
		return
	}

	switch {
	case mattermost.IsUnauthorized(err):
		// The user's Mattermost grant was revoked; the session is dead.
		s.writeJSON(w, http.StatusUnauthorized, errorBody{Error: "Mattermost session expired, please sign in again"})
		return
	case mattermost.IsForbidden(err):
		s.writeJSON(w, http.StatusForbidden, errorBody{Error: "not allowed in Mattermost"})
		return
	case mattermost.IsNotFound(err), miniflux.IsNotFound(err):
		s.writeJSON(w, http.StatusNotFound, errorBody{Error: "not found"})
		return
	}

	s.log.Error("request failed", "error", err, "method", r.Method, "path", r.URL.Path)
	s.writeJSON(w, http.StatusBadGateway, errorBody{Error: "upstream request failed"})
}

// pathInt reads an integer path parameter.
func pathInt(r *http.Request, name string) (int64, error) {
	raw := r.PathValue(name)
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, errBadRequest("invalid " + name)
	}
	return value, nil
}

// decodeJSON reads a JSON request body, rejecting unknown fields so a typo in a
// client payload fails loudly instead of being silently dropped.
func decodeJSON(r *http.Request, out any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return errBadRequest("invalid request body")
	}
	return nil
}
