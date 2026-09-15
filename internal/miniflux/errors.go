package miniflux

import "errors"

// asError is errors.As specialised to *Error, kept separate so client.go reads
// cleanly at its call sites.
func asError(err error, target **Error) bool {
	return errors.As(err, target)
}
