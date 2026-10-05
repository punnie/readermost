package api

import (
	"net/http"
	"slices"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/hub"
	"github.com/punnie/readermost/internal/store"
)

// The choices the reader offers. The frontend owns what each one looks like;
// the server only refuses values it would not know how to render.
var (
	fontFamilies = []string{"sans", "serif", "mono", "opendyslexic"}
	textSizes    = []string{"small", "medium", "large", "xlarge"}
	densities    = []string{"compact", "comfortable", "spacious"}
	accents      = []string{"blue", "teal", "green", "orange", "rose", "purple", "graphite"}
	unreadMarks  = []string{"count", "dot"}
)

// readingPrefs is the wire form of store.ReadingPrefs.
type readingPrefs struct {
	FontFamily string `json:"font_family"`
	TextSize   string `json:"text_size"`
	Density    string `json:"density"`
	Accent     string `json:"accent"`
	UnreadMark string `json:"unread_mark"`
}

func (p readingPrefs) validate() error {
	switch {
	case !slices.Contains(fontFamilies, p.FontFamily):
		return errBadRequest("unknown font family")
	case !slices.Contains(textSizes, p.TextSize):
		return errBadRequest("unknown text size")
	case !slices.Contains(densities, p.Density):
		return errBadRequest("unknown density")
	case !slices.Contains(accents, p.Accent):
		return errBadRequest("unknown accent colour")
	case !slices.Contains(unreadMarks, p.UnreadMark):
		return errBadRequest("unknown unread mark")
	}
	return nil
}

func (s *Server) handleGetPrefs(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	prefs, err := s.auth.Store().ReadingPrefs(r.Context(), identity.User.ID)
	if err != nil {
		return err
	}
	s.writeJSON(w, http.StatusOK, readingPrefs(prefs))
	return nil
}

// handlePutPrefs saves the whole set at once; there are five fields and the
// client always knows all of them.
func (s *Server) handlePutPrefs(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	var prefs readingPrefs
	if err := decodeJSON(r, &prefs); err != nil {
		return err
	}
	if err := prefs.validate(); err != nil {
		return err
	}
	if err := s.auth.Store().SetReadingPrefs(r.Context(), identity.User.ID, store.ReadingPrefs(prefs)); err != nil {
		return err
	}

	// Other open devices pick the change up now rather than on next focus.
	s.hub.Notify(identity.User.ID, hub.Event{Type: hub.EventPrefs})

	s.writeJSON(w, http.StatusOK, prefs)
	return nil
}
