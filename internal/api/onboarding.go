package api

import (
	"io"
	"net/http"

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
