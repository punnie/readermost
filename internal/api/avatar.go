package api

import (
	"io"
	"net/http"

	"github.com/punnie/readermost/internal/auth"
)

// avatarIDPattern guards the path parameter: Mattermost IDs are 26 characters
// of lowercase alphanumerics, and nothing else should reach the upstream URL.
func validMattermostID(id string) bool {
	if len(id) != 26 {
		return false
	}
	for _, r := range id {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

// handleAvatar proxies a Mattermost profile picture.
//
// The browser cannot fetch these directly: they need the user's token, which
// never leaves the server. Mattermost generates an initial-based image when
// someone has not set a picture, so this always returns something.
func (s *Server) handleAvatar(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	userID := r.PathValue("id")
	if !validMattermostID(userID) {
		return errBadRequest("invalid user id")
	}

	body, contentType, err := identity.Mattermost(s.mm).UserImage(r.Context(), userID)
	if err != nil {
		return err
	}
	defer body.Close()

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Avatars change rarely, and a stale one for an hour is not a problem worth
	// a revalidation round trip on every row of the river.
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)

	if _, err := io.Copy(w, body); err != nil {
		s.log.Warn("avatar copy failed", "error", err)
	}
	return nil
}
