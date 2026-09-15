package api

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/punnie/readermost/internal/auth"
	"github.com/punnie/readermost/internal/miniflux"
)

// maxOPMLSize caps an import. Real OPML files are tens of kilobytes; this is
// generous and still bounds what a single request can push at Miniflux.
const maxOPMLSize = 1 << 20 // 1 MiB

// handleImportOPML streams an uploaded OPML file into the user's Miniflux
// account. Miniflux does the parsing, de-duplication and category creation —
// none of that is reimplemented here.
func (s *Server) handleImportOPML(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	ctx := r.Context()

	body, err := opmlBody(r)
	if err != nil {
		return err
	}
	defer body.Close()

	var result *miniflux.ImportResult
	err = s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		result, err = client.ImportOPML(ctx, body)
		return err
	})
	if err != nil {
		return err
	}

	// Importing is one of the two ways to finish the welcome step.
	if err := s.auth.Store().MarkOnboarded(ctx, identity.User.ID); err != nil {
		s.log.Warn("mark onboarded failed", "error", err)
	}

	// Miniflux's import creates the feeds but does not fetch them — they sit
	// empty, with no entries and no favicon, until the poller comes round,
	// which can be an hour. Ask for a refresh so an import actually produces a
	// reader rather than a list of empty names.
	s.refreshAfterImport(identity)

	s.writeJSON(w, http.StatusOK, map[string]string{"message": result.Message})
	return nil
}

// opmlBody accepts either a multipart upload (the browser file picker) or a raw
// XML body (curl, scripts).
func opmlBody(r *http.Request) (io.ReadCloser, error) {
	contentType := r.Header.Get("Content-Type")

	if len(contentType) >= 19 && contentType[:19] == "multipart/form-data" {
		if err := r.ParseMultipartForm(maxOPMLSize); err != nil {
			return nil, errBadRequest("could not read the uploaded file")
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			return nil, errBadRequest("no file was uploaded")
		}
		if header.Size > maxOPMLSize {
			file.Close()
			return nil, errBadRequest("file is too large (max 1 MB)")
		}
		return file, nil
	}

	return http.MaxBytesReader(nil, r.Body, maxOPMLSize), nil
}

// handleExportOPML streams the user's subscriptions out, so leaving is as easy
// as arriving.
func (s *Server) handleExportOPML(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	ctx := r.Context()

	var body io.ReadCloser
	err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
		var err error
		body, err = client.ExportOPML(ctx)
		return err
	})
	if err != nil {
		return err
	}
	defer body.Close()

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="readermost-subscriptions.opml"`)
	w.WriteHeader(http.StatusOK)

	if _, err := io.Copy(w, body); err != nil {
		// Headers are already sent; the download will simply be truncated.
		s.log.Warn("opml export copy failed", "error", err)
	}
	return nil
}

// handleMarkOnboarded finishes the welcome step when the user skips it or adds
// their first feed by hand.
func (s *Server) handleMarkOnboarded(w http.ResponseWriter, r *http.Request, identity *auth.Identity) error {
	if err := s.auth.Store().MarkOnboarded(r.Context(), identity.User.ID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// refreshAfterImport asks Miniflux to poll the freshly imported feeds.
//
// It runs detached from the request: Miniflux returns immediately and does the
// fetching in the background, but a large import still leaves the call on the
// wrong side of the response, and the request context dies with it.
func (s *Server) refreshAfterImport(identity *auth.Identity) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		err := s.auth.WithMiniflux(ctx, identity, func(client *miniflux.Client) error {
			return client.RefreshAllFeeds(ctx)
		})
		if err != nil {
			// The feeds are imported either way; they will fill in on
			// Miniflux's own schedule.
			s.log.Warn("refresh after import failed", "error", err)
		}
	}()
}
